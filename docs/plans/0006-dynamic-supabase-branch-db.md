# Plan 0006 — Dynamic per-branch Supabase preview database

## Goal / problem

Branch-specific front-end previews should talk to **branch-specific Supabase
preview databases**, automatically, without merging into beta first.

Today the wiring is half-built:

- **Front-end:** Cloudflare Workers Builds deploys every non-`main` branch as a
  preview. `vite.config.ts` bakes Supabase creds in **at build time**; on a
  preview build the `pick()` helper prefers `*_PREVIEW` env vars.
- **The catch:** those `*_PREVIEW` vars are a *single static set* configured once
  in the Worker settings — they point at **one fixed DB (beta)**. So every branch
  preview hits the same beta DB. The only way to exercise a migration is to merge
  it into beta so the beta DB updates.
- **Supabase side:** Branching is enabled, so Supabase spins up a fresh
  **preview-branch database** per git branch — *but only when that branch carries
  migration changes* — each with its own project ref, API URL and anon key.
  Nothing told the front-end build those creds existed, so they went unused.

The missing piece is the link between "this git branch's Supabase preview DB" and
"this git branch's front-end build."

## Approach & key decisions

**Build-time resolution via the Supabase Management API.** During the Cloudflare
build, ask the Management API whether a preview branch exists for the current git
branch (`WORKERS_CI_BRANCH`); if so, bake *its* creds in. If not, fall back to the
existing static `_PREVIEW`/beta creds — i.e. today's behaviour, untouched.

Flow (`scripts/resolveSupabaseBranch.ts`):
1. Skip entirely unless it's a preview build with a `SUPABASE_ACCESS_TOKEN` and a
   non-`main` branch.
2. `GET /v1/projects/{prodRef}/branches` → find the non-default branch whose
   `git_branch` matches the build's branch.
3. **No match** → return null. This is the common "no DB changes, so Supabase made
   no branch" case — fall back to beta.
4. Match but **not healthy** (`status` not in `MIGRATIONS_PASSED` /
   `FUNCTIONS_DEPLOYED` / `ACTIVE_HEALTHY`) → null. Never point a front-end at a
   half-provisioned or migration-failed DB.
5. Healthy → URL `https://{branch.project_ref}.supabase.co`, anon key via
   `GET /v1/projects/{branch.project_ref}/api-keys`. Return `{ url, anonKey, projectId }`.

`vite.config.ts` calls this (the config factory is now `async`) and threads the
result into `pick()` as the **top-precedence override** for the three Supabase
keys only. Everything else flows through the existing precedence chain.

**Why build-time, not a runtime `config.json`?** The whole app is offline-first
with build-time-baked creds (see the `pick()` comment — "the only place to switch
backends"). A runtime config endpoint would add a network dependency on load and
fight that model. Build-time resolution drops into the existing seam with one new
secret and zero runtime cost. Rejected: runtime config.

**Safety — a backend lookup must never break a deploy.** The resolver never
throws: it has a 10s timeout, treats any non-OK/parse/network error as "fall
back", and returns null on every failure path. The static beta creds remain the
floor, so the worst case is "preview points at beta" — exactly where we are today.

**Why `scripts/`, not `src/`?** It's CI-only build tooling, never shipped to the
client, so it stays out of the app source tree and out of the `src/`-scoped
coverage report. `vitest.config.ts` gains a `scripts/**/*.test.ts` include so the
pure logic is still unit-tested.

## Touch points

- `scripts/resolveSupabaseBranch.ts` — the resolver (new).
- `scripts/resolveSupabaseBranch.test.ts` — unit tests (new).
- `vite.config.ts` — async factory; `pick()` gains an override arg; resolves
  `branchBackend` on preview builds and threads it into the 3 Supabase keys.
- `vitest.config.ts` — include `scripts/**/*.test.ts`.
- `README.md`, `CLAUDE.md` — `SUPABASE_ACCESS_TOKEN` env var + operator steps.

## Operator setup (one-time)

1. Create a Supabase **personal access token** (Account → Access Tokens) with
   access to the project.
2. Add it as a **secret** in the Worker → Settings → Build → Variables and
   Secrets: `SUPABASE_ACCESS_TOKEN`. (The static `*_PREVIEW` beta creds stay as
   the fallback.)
3. Add each preview branch's Cloudflare preview URL to that branch's Supabase
   **Auth → Redirect URLs** if cloud sign-in is needed on it.

> **"Branches aren't always generated."** That's inherent to Supabase Branching —
> a preview branch is created only when the branch has migration changes. This
> design embraces that: branches *with* DB changes get their own DB; branches
> without fall back to beta. If you want a branch DB regardless, push a no-op
> migration, or create the branch manually in the Supabase dashboard so the
> Management API lists it.

## Status / phasing

- **Done:** resolver + tests, vite wiring, docs. Green across lint / typecheck /
  test / build. With no `SUPABASE_ACCESS_TOKEN` set, behaviour is byte-identical
  to before (resolver short-circuits to null).
- **Pending (operator):** add the `SUPABASE_ACCESS_TOKEN` secret in Cloudflare to
  activate it.
- **Follow-ups:** if the new publishable/secret API-key scheme fully replaces the
  legacy `anon` key on branches, confirm `pickAnonKey` still finds a usable
  publishable key (it already falls back to `name === "publishable"`).
