
## Goal

Let any user (not just admins) sign up, sign in (email or Google), and reset their password so they can use Cloud Sync and future user features — **but keep the entire cloud/auth surface behind a single build-time flag** so the offline-first repo can ship with zero cloud code paths active. Admin status stays a separate concept driven by `user_roles`.

## Build-time gating model

One new flag controls all user-facing cloud auth: **`VITE_ENABLE_CLOUD`** (default `"false"`).

| Flag | Controls |
|------|----------|
| `VITE_ENABLE_CLOUD` | Public auth routes (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`), header "Sign in" entry, Cloud Sync Labs panel registration, Google OAuth button |
| `VITE_ENABLE_ADMIN` | `/admin` route + admin UI (unchanged) |
| `VITE_ENABLE_REGISTRATION` | **Retired** — registration follows `VITE_ENABLE_CLOUD` |

When `VITE_ENABLE_CLOUD !== 'true'`:
- None of the new auth pages are imported (lazy boundaries + conditional `<Route>` mounting, same pattern as `/admin` today).
- The cloud-sync plugin's `index.ts` early-returns from `setup()` so it never contributes a panel — Labs tab stays absent unless something else contributes.
- The header "Sign in" affordance is not rendered.
- `AuthContext` still mounts (admin build needs it), but the new `signUp` / `signInWithGoogle` methods are no-ops behind the same flag check — or, cleaner, the Google-specific lovable client import stays inside the lazy page modules so it never lands in the main chunk.

Admin builds independently set `VITE_ENABLE_ADMIN=true`; they continue to work whether cloud is on or off (admin login uses the existing `supabase.auth.signInWithPassword` path).

## Scope

1. **Routing (`src/App.tsx`)**
   - Add `const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';`
   - Mount the new public auth routes only when `enableCloud`. `/login` is mounted when `enableCloud || enableAdmin` (admin still needs it). Drop the `VITE_ENABLE_REGISTRATION` check.
   - All new pages lazy-loaded so the disabled build never downloads them.

2. **New pages (all lazy)**
   - `src/pages/ForgotPassword.tsx` — email → `supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + '/reset-password' })`.
   - `src/pages/ResetPassword.tsx` — public route, detects `type=recovery` hash, calls `supabase.auth.updateUser({ password })`, routes to `/`.
   - `src/pages/AuthCallback.tsx` at `/auth/callback` — waits for `onAuthStateChange`, then redirects to `?next=` or `/`.

3. **Rework `Login.tsx` / `Register.tsx`**
   - Reframe copy from "Admin Login" → "Sign in". Add a "Continue with Google" button at the top (rendered only when `enableCloud`).
   - Forgot-password becomes a link to `/forgot-password` instead of an inline toggle.
   - Keep the per-IP rate-limit edge function. Success redirects to `?next=` or `/` (admins land on `/admin` via the next param, set by header link).
   - Registration always-on under cloud flag; keep email-confirm flow (no auto-confirm).

4. **Google sign-in via Lovable Cloud managed OAuth**
   - Run `supabase--configure_social_auth` with `providers: ["google"]` (keep email).
   - Use `lovable.auth.signInWithOAuth("google", { redirect_uri: origin + "/auth/callback" })` from the scaffolded `src/integrations/lovable/`. Import only from the cloud-flagged pages so it tree-shakes out otherwise.
   - PWA: add `/^\/~oauth/` to `navigateFallbackDenylist` in `vite.config.ts` so OAuth redirects bypass the service worker.

5. **`AuthContext` additions**
   - Add `signUp(email, password)` and `signInWithGoogle()` wrappers next to existing `login` / `resetPassword`. Admin role detection via `has_role` stays unchanged — regular users have no `user_roles` row, so `isAdmin` is `false`.

6. **Cloud Sync plugin (`src/plugins/cloud-sync/index.ts`)**
   - In `setup()`, early-return when `VITE_ENABLE_CLOUD !== 'true'` so the Labs panel isn't contributed. `CloudSyncPanel.tsx` stays lazy and never imports.
   - When enabled, replace the inline email/password form with: blurb + "Sign in" / "Create account" buttons routing to `/login?next=/` and `/register`, plus a "Continue with Google" shortcut using the new context method. Smaller panel, no duplicated auth UI.

7. **Header / nav affordance (`LandingPage.tsx` or top of `Index.tsx`)**
   - Render a "Sign in" / account menu **only when `enableCloud`**. Signed-in users see email + Sign out; admins additionally see an Admin link (still gated by `isAdmin && enableAdmin`).

8. **Auth settings**
   - Call `supabase--configure_auth`: `disable_signup: false`, `auto_confirm_email: false`, `external_anonymous_users_enabled: false`, `password_hibp_enabled: true`.

9. **Docs**
   - `README.md`: add `VITE_ENABLE_CLOUD` row (default false; enables public auth + cloud sync); remove `VITE_ENABLE_REGISTRATION`; clarify `VITE_ENABLE_ADMIN` only gates `/admin`. Note offline-first invariant: with the flag off, no auth/cloud code runs.
   - `CLAUDE.md`: update env vars section, architecture map, and plugin notes (cloud-sync now flag-gated).
   - `CHANGELOG.md`: `[Unreleased]` entry under "Added" + "Changed" (flag rename).
   - Update memory `mem://config/environment-variables` and `mem://architecture/cloud-sync-strategy` to reflect the new flag.

## Out of scope

- Apple / other social providers (easy follow-up; Lovable Cloud supports Apple).
- Profiles table / display names / avatars — current features key off `auth.uid()` only.
- Branded auth emails (`scaffold_auth_email_templates`) and custom email domain.

## Technical notes

- Files added: `src/pages/ForgotPassword.tsx`, `src/pages/ResetPassword.tsx`, `src/pages/AuthCallback.tsx`.
- Files changed: `src/App.tsx`, `src/pages/Login.tsx`, `src/pages/Register.tsx`, `src/contexts/AuthContext.tsx`, `src/plugins/cloud-sync/index.ts`, `src/plugins/cloud-sync/CloudSyncPanel.tsx`, `vite.config.ts` (PWA denylist), `src/components/LandingPage.tsx` (or `Index.tsx` header), `README.md`, `CLAUDE.md`, `CHANGELOG.md`.
- Tool-generated (do not hand-edit): `src/integrations/lovable/` from `configure_social_auth`. Even when generated, it only runs at import time from cloud-flagged pages → stays out of the disabled build's bundle via lazy boundaries.
- No DB migration required.
- Verification: `npm run build` once with `VITE_ENABLE_CLOUD` unset (confirm auth chunks absent, Labs tab not auto-mounted), once with `VITE_ENABLE_CLOUD=true` (confirm routes + Google flow work).
