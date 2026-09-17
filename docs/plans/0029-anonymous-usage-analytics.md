# Anonymous usage analytics — PostHog, pageviews only, opt-out

> Status: **LANDED** (web app). Follow-up: same-origin reverse proxy (see
> *Pending*).

## Problem

The only traffic signal for lapwingdata.com was the request count on the
Cloudflare Workers dashboard. That can't answer the questions the maintainer
actually has: how many people use the app, how many of them **come back**, and
roughly **how long they stay**. Mandating accounts to find out is a non-starter
(offline-first, no-account core app is the product), and the privacy policy
promised "no analytics scripts, telemetry beacons or fingerprinting" — so
whatever was added had to be honest, minimal and switchable.

## Approach & key decisions

1. **PostHog, not GA4 / Plausible / Umami.** Returning-visitor counts need a
   stable anonymous id across visits. Plausible rotates its visitor hash daily
   by design, so it can only give uniques-per-day. GA4 sets cross-site cookies,
   needs a consent banner for EU visitors and is blocked by most ad blockers
   (a racing/tinkerer audience runs them at a high rate). PostHog's Web
   Analytics dashboard gives visitors / new-vs-returning / session duration /
   bounce / referrers / countries straight from `$pageview` + `$pageleave`,
   the free tier (1M events/month) is far above our traffic, and it has an EU
   cloud if wanted.

2. **Pageviews only.** `autocapture`, dead clicks, heatmaps, exception capture,
   session replay, surveys, web experiments and feature flags are all disabled
   in `lib/analytics.ts`. Nothing app-specific is ever `capture()`d — there is
   deliberately no `track()` helper to tempt anyone. If a product question ever
   needs an event, it gets its own plan and its own privacy-policy line.

3. **Opt-out, not opt-in, plus DNT.** A consent banner would be a worse
   experience than the analytics are worth. Instead: a `sendUsageStats`
   setting (default on) under *Settings → Privacy*, the privacy policy spells
   out exactly what is collected, and `respect_dnt: true` honours Do Not Track
   and Global Privacy Control. Opt-out is immediate (`opt_out_capturing`), and
   with the setting off **nothing is downloaded** — the gate runs before the
   dynamic import. The maintainer accepts that a strict GDPR reading treats a
   persistent id as consent-requiring; the audience is overwhelmingly US and
   the setting is one toggle away.

4. **The Settings toggle is the source of truth, not PostHog's stored consent.**
   PostHog persists its own opt-out flag. On start, if the setting is on but
   PostHog says opted out, we `opt_in_capturing({ captureEventName: false })`.
   This never overrides DNT: PostHog's consent getter returns "rejected" while
   DNT is set regardless of the stored value (verified in the SDK source).

5. **Web only, never native or embedded.** `initAnalytics()` runs in the same
   `main.tsx` branch as the service worker registration, so iframes, `?nosw=1`
   preview hosts and the Tauri/Android shell never start it. Keeping Android
   out means the Google Play Data Safety form is untouched. `isEmbedded()` and
   `isNativeApp()` are re-checked inside the module too.

6. **Absent when no key is baked in.** `VITE_POSTHOG_KEY` empty → `analyticsConfig()`
   is null → no code path loads PostHog, the Settings section is hidden, and the
   privacy policy renders its original "No Tracking or Advertising" section.
   Self-hosters and local dev get exactly the app they had before.

7. **Bundle budget.** `posthog-js` is ~300 kB unminified, so `lib/analytics.ts`
   (the only eager module) is a few hundred bytes of gating and dynamic-imports
   the SDK. `disable_external_dependency_loading: true` keeps PostHog from
   fetching extra scripts from its CDN at runtime — everything ships in our own
   bundle and therefore in the offline precache. `advanced_disable_flags: true`
   removes the `/flags` request (no feature flags in use).

8. **One project, channel-tagged.** Cloudflare build variables apply to every
   branch of the Worker, so beta/preview deploys would otherwise be
   indistinguishable from production. Every event carries super-properties
   `app_channel` (`production` | `preview`, from `isPreviewBuild()`),
   `app_version` and `app_display_mode` (`standalone` = installed PWA). The
   env var goes through vite's `pick()`, so `VITE_POSTHOG_KEY_PREVIEW` can
   instead point beta at a separate PostHog project.

9. **Anonymous events, no person profiles.** `person_profiles: 'identified_only'`
   — nobody is ever `identify()`d, so no person records are created. Signed-in
   cloud users could be linked to their account with one call; deliberately not
   done.

10. **Privacy policy is part of the change.** `pages/Privacy.tsx` gains an
    "Anonymous Usage Statistics" section (what is collected, what is not, how to
    switch it off), lists PostHog as a sub-processor, and mentions the visitor id
    under Cookies & Local Storage — each gated on `isAnalyticsAvailable()` so a
    keyless build still shows the original no-tracking wording.

### Operator setup

- Create a PostHog project; set `VITE_POSTHOG_KEY` (and `VITE_POSTHOG_HOST` for
  the EU cloud) as Cloudflare build variables.
- In the PostHog project settings enable **Discard client IP data** — the
  privacy policy says the IP is used for a coarse geo lookup and not retained.
- Use the **Web Analytics** dashboard, filtered on `app_channel = production`
  (or set `VITE_POSTHOG_KEY_PREVIEW` to a second project and skip the filter).

## Touch points

- `src/lib/analytics.ts` (+ `analytics.test.ts`) — config, gate, preference
  parsing, context properties, lazy client, opt-in/out bridge.
- `src/main.tsx` — `initAnalytics()` beside the SW registration.
- `src/hooks/useSettings.ts` — `sendUsageStats` (default true) + effect → `setUsageStatsEnabled`.
- `src/components/SettingsModal.tsx` — *Privacy* section, shown only when available.
- `src/locales/*/settings.json` — `privacy.*` keys.
- `src/pages/Privacy.tsx` — policy sections; `CreditsDialog.tsx` + README credits.
- `vite.config.ts` (`define` via `pick()`), `src/vite-env.d.ts`, README env tables, `CLAUDE.md`.

## Pending / follow-ups

- **Same-origin reverse proxy.** Ad blockers block `*.i.posthog.com`; the fix
  is routing `/ingest/*` through our own domain. The site is a static-assets
  Worker today (no `main` script), so this means adding a small fetch handler
  with `run_worker_first` for that path and pointing `VITE_POSTHOG_HOST` at it.
  Left out of the first PR to keep the deploy change separate; the host
  override already exists so it needs no app code.
- Revisit whether beta should get its own PostHog project once real traffic
  shows how noisy the shared-project filter is.
