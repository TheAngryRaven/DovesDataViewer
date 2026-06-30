# Dove's DataViewer


**Open source motorsport data acquisition and analytics**

[![Lint](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/lint.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/lint.yml)
[![Typecheck](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/typecheck.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/typecheck.yml)
[![Test](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/test.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/test.yml)
[![Build](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/build.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/build.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/TheAngryRaven/9c0c31f9c333c565804b26643a2e3aec/raw/coverage-badge.json)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/coverage.yml)

🌐 **Live Demo:** [LapWing](https://lapwingdata.com)  
🔧 **Hardware Project:** [DovesDataLogger on GitHub](https://github.com/TheAngryRaven/DovesDataLogger)

**Now officially in BETA status**
---

<p align="center">
  <img src="preview.jpg" />
</p>

---

## Features

- Multi-format file support (NMEA, UBX, iRacing IBT, VBO, MoTeC, AiM CSV + XRK/XRZ, Alfano, Dove, Dovex)
- Automatic track & course detection within 5 miles
- Automatic driving direction detection (forward/reverse)
- Waypoint mode — lap timing anywhere, no track needed
- Interactive race line map with speed heatmap
- Braking zone detection & visualization
- Automatic lap detection via start/finish line
- 3-sector split timing with optimal lap
- Pro graph view with multi-series telemetry charts
- Reference lap overlay & pace delta comparison
- Lap snapshots — save a "course fastest lap" per engine, frozen for cross-session comparison (local-first, optionally cloud-synced)
- Public leaderboards — submit your snapshots and browse fastest community laps by track, course and engine class (with optional weight grouping); opens any group in a read-only viewer (cloud-enabled builds)
- Video sync with telemetry playback (incl. GoPro chunked recordings — select all chapter files and they play as one continuous video)
- 9 overlay gauge types (digital, analog, graph, bar, bubble, map, pace, sector, lap time)
- MP4 video export with overlays & audio (H.264 + AAC)
- Vehicle profiles & setup sheet management
- Session notes per file
- BLE device integration (DovesDataLogger)
- Device track sync over Bluetooth
- Custom track & course editor with community submissions
- Local weather lookup
- Optional cloud sync of files & garage data across devices (requires backend + sign-in)
- Dark & light mode
- PWA — installable & fully offline

---

## Philosophy

This project is **100% open source**. The entire codebase—every feature, every parser, every visualization—is freely available for anyone to use, modify, and self-host.

- **Local Processing:** All data analysis happens in your browser. Your telemetry data never leaves your device.
- **No Server Required:** No uploads, no database, no accounts, no cloud sync.
- **Team Transparency:** Organizations can audit the code themselves for security compliance.

## Free Forever

- **Single file processing on LapWing is always free**—no download or account required
- **Self-hosting is always an option**—clone this repo and run it yourself
- The only potential future paid feature: optional cloud storage for users who *want* hosted data retention on *my* infrastructure

---

## Supported File Formats

All formats are auto-detected on import:

| Format | Source | Extension |
|--------|--------|-----------|
| UBX Binary | u-blox GPS receivers | `.ubx` |
| iRacing IBT | iRacing sim native binary telemetry | `.ibt` |
| VBO | Racelogic VBOX, RaceBox | `.vbo` |
| Dove CSV | DovesDataLogger | `.dove` |
| Dovex | DovesDataLogger (extended with metadata) | `.dovex` |
| Dovep | Phone Lap Timer tool (Dove-phone; `.dovex`-compatible) | `.dovep` |
| Alfano CSV | Alfano ADA app, Off Camber Data | `.csv` |
| AiM CSV | MyChron 5/6, Race Studio 3 | `.csv` |
| AiM XRK/XRZ | MyChron / SoloDL native binary | `.xrk`, `.xrz` |
| MoTeC CSV | MoTeC i2 Pro export | `.csv` |
| MoTeC LD | MoTeC native binary | `.ld` |
| NMEA | Standard GPS sentences | `.nmea`, `.txt`, `.csv` |

> **AiM XRK/XRZ** is parsed by [libxrk](https://github.com/m3rlin45/libxrk)'s
> pure-Rust core **compiled to a small (~200 KB) WebAssembly module** — no
> Pyodide, no Python. It runs entirely **client-side** in a Web Worker, is fully
> **offline** (the wasm is precached), and parses a typical session in tens to a
> couple hundred milliseconds. See
> [AiM XRK / XRZ import](#aim-xrk--xrz-import) for how the wasm is built and pinned.

> **iRacing IBT** is the sim's only native on-disk telemetry export — the binary
> `.ibt` file iRacing writes (at the session tick rate, typically 60 Hz) once
> logging is armed (Alt-L, or the always-on telemetry setting). It is the same
> data the live shared-memory irsdk API serves; iRacing has no built-in
> CSV/MoTeC export (those are third-party conversions of this same file), so we
> parse the `.ibt` directly. GPS `Lat`/`Lon`/`Speed`/`Alt` make it a first-class
> GPS source; driver inputs (throttle, brake, gear, steering), engine channels
> (RPM, water/oil temp) and native lateral/longitudinal g ride along.

---

## Languages

The interface is available in **English, Spanish, French, German, Italian,
Brazilian Portuguese and Japanese**, switchable in Settings (auto-detected from
your browser on first run). Translations load on demand and are cached for full
offline use. English is the source of truth; the other languages start as
machine translations (built on [i18next](https://www.i18next.com)) and are
hand-tuned over time — contributions welcome via `src/locales/`. Translation
coverage is being rolled out screen by screen.

Maintainers seed/refresh non-English locales from the English source with
`bun run i18n:seed` (needs `ANTHROPIC_API_KEY`; see the translation plan in
`docs/plans/0004-i18n-translation-system.md`). Legal pages remain English by design.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Mapping | Leaflet (CARTO basemaps + Esri World Imagery / Wayback) |
| Charts | Custom Canvas 2D renderer |
| Video Export | WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 MP4) |
| State | React Query |
| Backend | **None** – zero server dependencies (optional admin backend via Supabase) |
| BLE | Web Bluetooth API for DovesDataLogger device communication & settings |

---

## Admin Panel & Track Database (Optional)

The app includes an optional admin system for managing a community track database. When enabled, users can submit new tracks/courses for review, and admins can manage everything through a web interface.

**The app always reads tracks from `public/tracks.json` — zero database calls on normal page loads.** The database exists solely for the admin workflow.

**Course sectors.** A course may define an ordered list of up to 25 timing
lines (start/finish + sub-sectors), exactly three of which are "major"
(start/finish + two). In the track JSON each course carries a canonical
`sectors` array — `[{ a_lat, a_lng, b_lat, b_lng, major }]` (start/finish
excluded) — alongside the legacy `sector_2_*`/`sector_3_*` fields, which mirror
the two major lines for back-compat. **Only the three major sectors are exported
to the DovesDataLogger** (over the same wire format as before); sub-sectors are
an app-only refinement used for finer optimal-lap timing and the lap-table "Full"
view. Older JSON with only `sector_2_*`/`sector_3_*` is read as the two majors.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes (if using Cloud) | Backend URL (your Supabase project) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes (if using Cloud) | Backend public/anon key (your Supabase project) |
| `VITE_SUPABASE_PROJECT_ID` | Yes (if using Cloud) | Backend project ID (your Supabase project) |
| `VITE_ENABLE_ADMIN` | No | Set to `true` to enable admin UI and `/admin` route. `/login` mounts when admin OR cloud is enabled. Default `false` — a fresh clone ships the public, offline-first app, not admin UI pointed at an upstream backend. |
| `VITE_ENABLE_CLOUD` | No | Set to `true` to enable public user accounts: Cloud Sync panels, email sign-in/registration, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`. Default `false` — flag-off builds ship zero cloud auth code (offline-first invariant). |
| `VITE_IS_NATIVE` | No | Set to `true` **only** for the native (Tauri/Android) shell build. Skips the service worker, hides in-app purchases (paid plans are web-only — Google Play billing policy; cloud sync still works), and opens external links in the system browser. The web app leaves this unset/`false`. See [`docs/android.md`](docs/android.md). |
| `VITE_TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key for track submission CAPTCHA |
| `VITE_FIRMWARE_MANIFEST_URL` | No | Override the DovesDataLogger firmware OTA manifest URL used by the in-app firmware updater. When unset: `main` builds use the production manifest (`https://theangryraven.github.io/DovesDataLogger/manifest.json`); non-`main`/preview builds use the **beta channel** (`https://theangryraven.github.io/DovesDataLogger/beta/manifest.json`). Set this to force a specific channel on any branch. |
| `TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret key (edge function secret — `???`) |
| `STRIPE_SECRET_KEY` | No (required for paid tiers) | Stripe secret key used by the `create-checkout-session`, `stripe-webhook`, and `create-portal-session` edge functions (edge function secret — `???`) |
| `STRIPE_WEBHOOK_SECRET` | No (required for paid tiers) | Signing secret for the `stripe-webhook` endpoint, from the Stripe dashboard webhook config (edge function secret — `???`) |
| `DELETION_CRON_SECRET` | No (required for scheduled account deletion) | Shared secret the `process-account-deletions` edge function requires in the `x-cron-secret` header. Must match the Vault secret `deletion_cron_secret` that the daily pg_cron job sends (edge function secret — `???`) |
| `SUPABASE_ACCESS_TOKEN` | No (preview-branch DBs) | Build-time secret: a Supabase **personal access token**. When set, a **feature-branch** build (not `main`, not `BETA`) resolves its own per-branch Supabase preview database via the Management API and bakes those creds in, falling back to the static `*_PREVIEW`/beta creds when the branch has no preview DB. See *Preview-branch backend* below. Never read by `main`/`BETA` builds, local dev, or the runtime app. |
| `DOVE_PLUGIN_PACKAGES` | No | Build-time: comma-separated external plugin npm packages to load. Overrides the default (`@perchwerks/eye-in-the-sky`, the public AI coach) when set |
| `ANTHROPIC_API_KEY` | No (translation tooling) | Required by `bun run i18n:seed` to machine-translate locale files (`scripts/seed-translations.mjs`). Maintainer tool only — never read by the app or the standard CI build (`???`). |
| `I18N_SEED_MODEL` | No | Optional model override for `bun run i18n:seed` (default `claude-sonnet-4-6`). |

> **Note:** `TURNSTILE_SECRET_KEY` is a server-side secret stored in your Supabase project, not a `VITE_` client variable. If not set, Turnstile verification is skipped.

> **Build version stamp:** `VITE_APP_VERSION`, `VITE_GIT_HASH`, `VITE_BUILD_DATE`,
> `VITE_GIT_BRANCH`, and `VITE_GIT_COMMIT_DATE` are **not** configured by hand —
> `vite.config.ts` bakes them in automatically (from `package.json` and git) for
> the home-page footer version/commit stamp. The stamp mirrors the `_PREVIEW`
> backend switch: a `main` build shows **`v<version> · <hash>`**, while any other
> branch shows **`<branch> · <hash> · <commit time>`**. The commit hash prefers
> CI-provided SHAs (`WORKERS_CI_COMMIT_SHA` / `CF_PAGES_COMMIT_SHA` /
> `GITHUB_SHA`) and the branch prefers CI branch vars (`WORKERS_CI_BRANCH` /
> `CF_PAGES_BRANCH` / `GITHUB_REF_NAME`) so both are correct even on shallow
> checkouts, falling back to a local `git` call and then `"unknown"`.

> **Stripe / paid tiers:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are
> edge-function secrets (not `VITE_` client vars). Prices are resolved live by
> **lookup_key** — there are no Price ids in code or env. Create the
> Plus/Premium/Pro Products in Stripe with one recurring Price per billing
> interval, each tagged with the matching lookup_key:
> `plus_monthly`, `plus_annual`, `premium_monthly`, `premium_annual`,
> `pro_monthly`, `pro_annual`. Then point a Stripe webhook (events:
> `checkout.session.completed`, `customer.subscription.created/updated/deleted`)
> at the `stripe-webhook` function URL. When `STRIPE_SECRET_KEY` is absent the
> pricing UI falls back to showing only the two free cards (Guest + Free). Use
> Stripe **test mode** first. Tier entitlements are granted only by the webhook,
> never the client.
>
> **On-hold / comped tiers:** the **Premium** and **Pro** (AI) tiers are listed in
> `COMING_SOON_TIERS` (`src/lib/billing.ts`, mirrored in `create-checkout-session`)
> so they're hidden from the pricing UI entirely and can't be bought via the app
> (only **Free** + **Plus** are shown at launch). To give one to a tester/friend,
> create the subscription directly in Stripe on the `premium_*` / `pro_*` price and
> set the subscription's `metadata.user_id` to their account id (or change an
> existing customer's price) — the webhook grants it. Remove the tier from both
> `COMING_SOON_TIERS` sets to open self-service purchase.
>
> **Cancellation grace + log trimming:** a cancelled subscription ends at the
> period boundary and drops to the free tier's limit immediately, but the
> user's cloud logs are kept for a 60-day grace window (`grace_until`). After it
> expires, the `trim_expired_logs()` function (scheduled daily via `pg_cron`)
> deletes their synced log files newest-first until their pooled total (docs +
> remaining logs + snapshots) fits the free `total_bytes` allowance; snapshots
> and garage docs are never auto-deleted. If `pg_cron` isn't enabled on the
> project, enable it (Dashboard → Database → Extensions) or invoke
> `select public.trim_expired_logs();` from an external scheduler.

> **Note:** `DOVE_PLUGIN_PACKAGES` is build-time only (read by `vite.config.ts`), not a client `VITE_` variable. It overrides which external plugin packages the build loads; by default the build pulls in the public AI coach (`@perchwerks/eye-in-the-sky`) from npm as an optional dependency — see `src/plugins/README.md`.

> **Build fallback:** `vite.config.ts` now hardcodes the project's public backend URL, publishable key, and project ID as a fallback for production builds. Local `.env` values still take precedence, but published builds no longer white-screen if managed env injection is temporarily missing.

> **PWA cache recovery:** the legacy `/sw.js` path now ships a one-release cleanup worker that deletes old app caches and unregisters itself without touching IndexedDB telemetry/session data. The active offline worker is now published at `/service-worker.js`, and HTML navigations use `NetworkFirst` to reduce the chance of users getting stuck on an old shell after future deploys.

### Database Setup

The admin system uses Supabase for the database. The schema is created automatically via migrations. Tables:

- **tracks** — Track names with short names (max 8 chars) and enabled flag
- **courses** — Course definitions with start/finish and optional sector lines
- **submissions** — User-submitted tracks/courses pending admin review
- **banned_ips** — IP addresses blocked from submissions
- **login_attempts** — Rate limiting for login (5 attempts, 1 hour lockout)
- **user_roles** — Admin/user role assignments (uses `has_role()` security definer)
- **sync_records** — Per-user cloud-sync documents (files/garage data), RLS-scoped to the owner
- **user-files** (Storage bucket) — Private per-user session file blobs for cloud sync
- **lap_snapshots** — Per-user frozen "course fastest lap" captures (one per course+engine), RLS-scoped; its own table, but its size counts toward the unified storage pool (below)
- **subscription_tiers** — Data-driven plan catalogue (free/plus/premium/pro): label, price, and a single pooled cloud-storage budget (`total_bytes`: 50 MB / 10 GB / 100 GB / 500 GB) shared by documents + logs + snapshots
- **user_subscriptions** — Per-user tier + Stripe customer/subscription state, status, renewal date, cancellation grace (service-role-written only)
- **profiles** — Per-user unique, editable display name
- **account_deletions** — Pending self-service account-deletion requests (7-day, reversible grace window)

> **Data retention (GDPR):** a daily `pg_cron` job runs
> `purge_expired_personal_data()`, which nulls the submitter IP on `submissions`
> and `messages` 90 days after they were received, deletes the rows entirely
> after 1 year (all `messages`; `submissions` only once reviewed — pending ones
> are kept for moderation), and deletes expired `banned_ips` / stale
> `login_attempts`. Account deletion is scheduled 7 days out
> (cancellable); the `process-account-deletions` worker then removes the user's
> Storage objects and auth row. To auto-schedule that worker, add a Supabase
> **Vault** secret named `deletion_cron_secret` and set the matching
> `DELETION_CRON_SECRET` env on the function, then re-run the GDPR migration —
> it wires the daily `pg_cron` + `pg_net` job for you.

> Cloud sync is independent of the admin system — it only needs a signed-in user
> account, not the admin role. It's an online-only, opt-in feature; the core app
> stays fully offline without it.

### Modular Database Layer

All database code lives behind `src/lib/db/` with a clean interface (`ITrackDatabase`). The current implementation uses Supabase, but you can swap in PostgreSQL/MySQL by implementing the same interface:

```
src/lib/db/
  types.ts            — Interface definitions
  supabaseAdapter.ts  — Supabase implementation  
  index.ts            — Factory: getDatabase()
```

### Admin Features

- **Submissions** — Approve/deny user-submitted tracks and courses
- **Tracks CRUD** — Add, edit, enable/disable, delete tracks (with short names)
- **Courses CRUD** — Manage courses per track with coordinate editing
- **Tools** — Build `tracks.json` from DB, download tracks ZIP, import JSON to rebuild DB, export/import course drawings
- **Banned IPs** — View and manage banned IP addresses, with a selectable expiry (TTL; defaults to 90 days, expired bans auto-purged)

### Edge Functions

| Function | Purpose |
|----------|---------|
| `submit-track` | Public endpoint for track submissions (with IP ban check); attributes the submission to the signed-in user when a valid JWT is present |
| `admin-build-zip` | Admin-only: generates per-track JSON files |
| `admin-users` | Admin-only: lists users with plan/storage/contribution count; grants or clears comped premium months |
| `check-login-rate` | Rate limiting for login attempts |
| `submit-message` | Public contact-form endpoint (with IP ban + rate limit) |
| `stripe-prices` | Public: reports whether Stripe is configured + live monthly/annual prices (resolved by lookup_key) for the pricing UI |
| `create-checkout-session` | Auth: starts Stripe Checkout for a tier + interval |
| `create-portal-session` | Auth: opens the Stripe Billing Portal (manage/cancel/renewal) |
| `stripe-webhook` | Stripe-signed: the only writer of subscription tier/status + grace window |
| `export-account-data` | Authenticated: returns all server-side data for the caller (GDPR access/portability) |
| `request-account-deletion` | Authenticated: schedules the caller's account for deletion 7 days out |
| `process-account-deletions` | Cron-only (`x-cron-secret`): erases Storage objects + auth rows for accounts past their grace window |

### Track Short Names

Every track has a `short_name` (max 8 characters) used for:
- ZIP export filenames (`OKC.json`)
- Compact UI display in the header
- Falls back to `abbreviateTrackName()` for tracks without a short name

### First-Time Setup

1. Provision a Supabase project
2. Run the database migration (automatic)
3. Create an admin user via the auth system
4. Add the admin role: `INSERT INTO user_roles (user_id, role) VALUES ('<your-user-id>', 'admin');`
5. Set `VITE_ENABLE_ADMIN=true`

---

## Local Development

### Prerequisites

- Node.js 18+ (or [Bun](https://bun.sh))

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/doves-dataviewer.git
cd doves-dataviewer

# Install dependencies
bun install

# Start development server
bun run dev
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

> **Package manager:** this project standardizes on **[Bun](https://bun.sh)**.
> `bun.lock` is the **only** committed lockfile — CI and the Cloudflare deploy
> both run `bun install --frozen-lockfile`, so don't add an npm/yarn/pnpm
> lockfile (a second lockfile drifts and breaks the frozen install).

### Available Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server on port 8080 |
| `bun run build` | Production build to `dist/` |
| `bun run preview` | Preview production build locally |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Type-check via `tsc -b` (build mode — follows project references) |
| `bun run test` | Run Vitest in watch mode (use `bun run test`, **not** `bun test`, which is Bun's own runner) |
| `bun run test:run` | Run Vitest once (CI-style) |

### On-screen debug console (`?dbg=true`)

Phones and installed PWAs have no dev-tools console, so a silent runtime error is
invisible. Append **`?dbg=true`** to the URL to show a bottom overlay that mirrors
all `console.*` output plus uncaught errors and unhandled promise rejections, with
copy / clear / collapse controls. The flag is sticky (persisted to
`localStorage`); load `?dbg=false` to turn it back off. The capture installs
before first render so early errors are caught, and the overlay renders nothing
unless enabled. Implemented in `src/lib/debugConsole.ts` (pure flag-parse + log
buffer + capture) and `src/components/DebugConsole.tsx` (overlay).

### Coverage badge

The live coverage badge is a [shields.io endpoint](https://shields.io/badges/endpoint-badge)
backed by a **GitHub Gist** (not a Git branch — that kept Cloudflare Workers
Builds trying to deploy a badge-only branch). The `coverage.yml` workflow runs
`bun run coverage:badge` (which computes the `%` + color from the Vitest summary)
and pushes those fields to the gist on every push to `main`. To wire it up on a
fork:

1. Create a **public** gist with a single file named `coverage-badge.json`
   (any placeholder contents) and copy its ID from the URL
   (`gist.github.com/<user>/<THIS_IS_THE_ID>`).
2. Create a fine-grained/classic **PAT with the `gist` scope** and add it as the
   repo secret **`GIST_TOKEN`** (Settings → Secrets and variables → Actions).
3. Add the gist ID as the repo **variable `COVERAGE_GIST_ID`** (same page → Variables).
4. Replace `COVERAGE_GIST_ID` in the Coverage badge URL at the top of this README
   with your gist ID.

---

## Deployment

The app is a **static single-page app** — `bun run build` emits a self-contained
`dist/` folder (HTML + hashed JS/CSS + assets) with no server runtime to host.
It runs on any static host. The optional admin backend (Supabase) is independent
and unaffected by where the frontend is served — the browser just calls it over
HTTPS.

### Cloudflare Workers

The repo ships ready for Cloudflare Workers (static assets) via the GitHub
integration / Workers Builds:

1. In the Cloudflare dashboard, create a **Worker** and connect this repo
   (Workers Builds).
2. Build settings:
   - **Build command:** `bun run build`
   - **Deploy command:** `npx wrangler deploy` (Workers Builds default).
   - **Node version:** pinned to `20` via `.nvmrc` (matches CI).
3. **`wrangler.jsonc`** (repo root) configures the deploy — there's no Worker
   script, just a static-assets binding:
   - `assets.directory: "./dist"` — uploads the Vite build output.
   - `not_found_handling: "single-page-application"` — returns the app shell
     (`index.html`) for unmatched client-side routes like `/privacy` and
     `/admin` instead of 404ing.
4. **`public/_headers`** is copied into `./dist` and honored by Workers static
   assets: it forces `no-cache` on the service workers + `index.html` (so new
   deploys take over instead of clients running a stale shell) and long-lived
   `immutable` caching on hashed `/assets/*`.

#### Environment variables (Worker → Settings → Variables)

The public viewer needs **none** — `vite.config.ts` hardcodes public backend
fallbacks, so a zero-config build serves the full offline app with admin off.

To run the admin/track-submission features on the Cloudflare deploy, set these
build-time variables (they're baked in at build, so a redeploy is required after
changing them):

| Variable | Value |
|----------|-------|
| `VITE_ENABLE_ADMIN` | `true` |
| `VITE_ENABLE_REGISTRATION` | `true` (only if you want the `/register` route) |
| `VITE_SUPABASE_URL` | your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | your Supabase anon key |
| `VITE_SUPABASE_PROJECT_ID` | your Supabase project ID |
| `VITE_TURNSTILE_SITE_KEY` | optional — Turnstile site key for the contact/submission CAPTCHA |

`TURNSTILE_SECRET_KEY` stays a **Supabase edge-function secret** — it is never a
client variable and does not belong in Cloudflare. The Supabase edge functions
(`supabase/functions/`) continue to run on Supabase; the Worker only serves the
static frontend.

#### Preview-branch backend (Supabase Branching → preview deployments)

The build picks its Supabase backend by **git branch**, in three tiers:

| Branch | Database | How it's chosen |
|--------|----------|-----------------|
| `main` | production | base build vars (`VITE_*` / `HTT_*`) |
| `BETA` | the shared beta DB | the `*_PREVIEW` build vars |
| any other branch | that branch's **own** Supabase preview-branch DB | resolved via the Management API, falling back to `*_PREVIEW`/beta when none exists |

`BETA` is the shared integration database and is **never** routed onto a per-branch
DB — only feature branches consult the resolver. Each build logs the result
(`[backend] Supabase URL baked: … — <tier>`) so a deploy always states which DB it
baked and why. Set the `*_PREVIEW` vars so non-`main` builds don't touch production:

Workers Builds exposes `WORKERS_CI_BRANCH` (Pages: `CF_PAGES_BRANCH`) on every
build; `vite.config.ts` prefers the `_PREVIEW` value of each key whenever the
branch isn't `main`, and ignores them on `main` and in local dev.

1. Enable **Branching** in Supabase, then copy the preview branch's URL, anon
   key, and project ref from the **Branches** panel.
2. In the Worker → **Settings → Build → Variables and Secrets**, add (alongside
   the production values):

   | Variable | Value |
   |----------|-------|
   | `HTT_SUPABASE_URL_PREVIEW` | preview branch URL |
   | `HTT_SUPABASE_PUBLISHABLE_KEY_PREVIEW` | preview branch anon key |
   | `HTT_SUPABASE_PROJECT_ID_PREVIEW` | preview branch project ref |

   Any key works the same way (e.g. `HTT_ENABLE_CLOUD_PREVIEW`). `VITE_*_PREVIEW`
   is also accepted. Add the Cloudflare preview URL to the preview branch's
   **Auth → Redirect URLs** so cloud sign-in works there.

##### Dynamic per-branch databases (feature branches)

Without a token, every non-`main` preview (including feature branches) uses the
static `*_PREVIEW`/beta DB. To instead give each **feature** branch its **own**
Supabase preview-branch database — so its preview deployment exercises that
branch's migrations without merging into beta first — add a `SUPABASE_ACCESS_TOKEN`
build secret (`BETA` always stays on `*_PREVIEW` regardless):

1. Create a Supabase **personal access token** (Account → Access Tokens).
2. Worker → **Settings → Build → Variables and Secrets** → add it as a secret:
   `SUPABASE_ACCESS_TOKEN` (keep the static `*_PREVIEW` values as the fallback).

On a **feature-branch** build (not `main`, not `BETA`), `vite.config.ts` asks the
Supabase **Management API** whether a preview branch exists for the build's git
branch (`scripts/resolveSupabaseBranch.ts`). If one does and it's healthy, that
branch's URL + anon key + ref are baked in; otherwise it falls back to the static
`*_PREVIEW`/beta creds. The lookup never throws and times out fast, so it can't
break a deploy. Full design: [`docs/plans/0007-dynamic-supabase-branch-db.md`](docs/plans/0007-dynamic-supabase-branch-db.md).

> Supabase only generates a preview branch when the git branch carries **migration
> changes**. Branches without DB changes simply fall back to beta. To force a DB
> for a branch anyway, push a no-op migration or create the branch by hand in the
> Supabase dashboard. Remember to add each preview URL to the branch's
> **Auth → Redirect URLs** for cloud sign-in.

#### Custom domains (production + beta)

- **Production — `lapwingdata.com`:** `wrangler.jsonc` declares a
  `custom_domain` route, so `wrangler deploy` provisions the DNS record and TLS
  certificate automatically. The zone `lapwingdata.com` must be in the same
  Cloudflare account; **do not also attach the domain by hand** in the dashboard
  or the bindings conflict.
- **Beta — `beta.lapwingdata.com`:** custom domains can't attach to a Branch
  Preview URL, so a separate thin reverse-proxy Worker owns the beta hostname and
  forwards to the stable `beta` preview (`beta-lapwing.perchwerks.workers.dev`).
  It lives in [`beta-proxy/`](beta-proxy/README.md) and is deployed on its own
  (`cd beta-proxy && npm install && npm run deploy`). Keep Cloudflare Access
  **off** on the upstream preview URL — see that README.

### Android app (Tauri)

The same frontend also serves a native **Android** app built with Tauri (in a
separate repo) — the web app is unchanged. Build the bundle with
`VITE_IS_NATIVE=true` and the app skips the service worker, hides in-app purchases
(paid plans stay web-only per Google Play's billing policy; cloud sync still
works), and opens external links in the system browser. See
[`docs/android.md`](docs/android.md) for the platform layer, the native bridge
contract, the Data Safety form, and the Android permission set.

---

## Project Structure

```
src/
├── components/       # React components
│   ├── ui/          # shadcn/ui base components
│   ├── admin/       # Admin panel tabs
│   ├── RaceLineView.tsx
│   ├── TelemetryChart.tsx
│   └── ...
├── lib/             # Parsers and utilities
│   ├── db/          # Modular database layer
│   ├── nmeaParser.ts
│   ├── ubxParser.ts
│   ├── iracingParser.ts
│   ├── vboParser.ts
│   ├── doveParser.ts
│   ├── alfanoParser.ts
│   ├── aimParser.ts
│   ├── motecParser.ts
│   └── ...
├── hooks/           # React hooks
├── pages/           # Route pages
└── types/           # TypeScript definitions
```

---

## Contributing

Contributions are welcome — new parsers, bug fixes, overlays, and reusability
rewrites especially. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for dev setup,
coding conventions, how to add a new parser, and the PR checklist.

By participating you agree to abide by our Code of Conduct (`CODE_OF_CONDUCT.md`).

Found a security issue? Please follow the disclosure process in
**[SECURITY.md](SECURITY.md)** rather than opening a public issue.

Release history is tracked in **[CHANGELOG.md](CHANGELOG.md)**.

---

## AiM XRK / XRZ import

AiM's native binary logs (`.xrk`, and zlib-compressed `.xrz`) are parsed
**entirely in the browser** by [libxrk](https://github.com/m3rlin45/libxrk)'s
**pure-Rust core compiled to WebAssembly** (no Pyodide, no Python). No server
round-trip; nothing is uploaded. XRK behaves like every other format — fast,
fully offline, and usable as the main session, a reference, or an overlay.

**How it runs (`src/lib/xrk/`):**

- The wasm module (`src/lib/xrk/wasm/`, ~200 KB, precached) is instantiated in a
  **Web Worker** the first time an XRK/XRZ file is parsed, so building a large
  session's arrays never freezes the UI.
- `xrkWorker.ts` runs libxrk on the uploaded bytes, then `xrkResample.ts` (pure,
  unit-tested) aligns every channel onto the GPS timebase (interpolate vs
  forward-fill per channel), and the worker ships the result back as transferable
  `Float64Array` buffers.
- `xrkMapping.ts` (pure, unit-tested) turns those channels into the app's
  `ParsedData` — GPS Latitude/Longitude/Speed become the sample primaries; the
  rest map to the canonical channel registry (`channels.ts`).
- Progress (load → parse → align) is surfaced in the import UI.

**Page weight & timing** (3.1 MB `.xrk` / 4.4 MB `.xrz`, measured in Node — the
browser is comparable):

| Cost | When | Size / time |
|------|------|-------------|
| App bundle delta | every load | ~negligible — a few KB of eager glue; the worker is a separate ~6 KB lazy chunk |
| libxrk wasm (`src/lib/xrk/wasm/`) | first XRK import (precached) | **~200 KB** (~81 KB gzipped), instantiate in ~tens of ms |
| Parse | per file | **~0.1 s** (3.1 MB / 4.7k samples) · **~0.3 s** (4.4 MB / 42k samples) |

**Building / updating the wasm.** The artifacts are committed under
`src/lib/xrk/wasm/`, built from libxrk's pure-Rust core via the thin wrapper
crate in `xrk-wasm/` (which pins the libxrk revision in `xrk-wasm/Cargo.toml`).
To rebuild (e.g. to bump libxrk), run:

```bash
scripts/build-xrk-wasm.sh   # needs rustup + (auto-downloads) wasm-bindgen
```

Bump the libxrk `rev` in `xrk-wasm/Cargo.toml` + the `wasm-bindgen` version in
the build script together, then re-run it and commit the regenerated artifacts.
License notices for libxrk + TrackDataAnalysis ship at
`src/lib/xrk/wasm/THIRD-PARTY-NOTICES.txt`.


---

## Credits

Built on the shoulders of these incredible open-source projects and free services:

- [React](https://react.dev) · [Vite](https://vite.dev) · [TypeScript](https://www.typescriptlang.org) · [Tauri](https://tauri.app) (native shell IPC, native-only)
- [Tailwind CSS](https://tailwindcss.com) · [shadcn/ui](https://ui.shadcn.com) · [Radix UI](https://www.radix-ui.com) · [Lucide Icons](https://lucide.dev)
- [Inter](https://rsms.me/inter/) · [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (OFL fonts) · [Fontsource](https://fontsource.org) (self-hosted, offline-ready)
- [Leaflet](https://leafletjs.com) · [CARTO basemaps](https://carto.com) · [Esri World Imagery & Wayback](https://livingatlas.arcgis.com/wayback/) (satellite + historical imagery dates)
- [TanStack Query](https://tanstack.com/query) · [Sonner](https://sonner.emilkowal.dev) · [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) · [dnd kit](https://dndkit.com) (sector list drag-to-reorder)
- [i18next](https://www.i18next.com) · [react-i18next](https://react.i18next.com) (internationalization)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) · [Savitzky-Golay (ml.js)](https://github.com/mljs/savitzky-golay) · [JSZip](https://stuk.github.io/jszip) · [fix-webm-duration](https://github.com/yusitnikov/fix-webm-duration)
- [IEM ASOS (Iowa State)](https://mesonet.agron.iastate.edu) · [NWS API](https://www.weather.gov/documentation/services-web-api) · [Open-Meteo](https://open-meteo.com) (global weather fallback, CC-BY 4.0)
- [MoTeC i2](https://www.motec.com.au) (file format reference)
- [libxrk](https://github.com/m3rlin45/libxrk) (MIT) + [TrackDataAnalysis](https://github.com/racer-coder/TrackDataAnalysis) (MIT) — AiM XRK/XRZ parser (Rust → WebAssembly)

Optional admin backend powered by [Supabase](https://supabase.com).

---

## License

Licensed under the **GNU General Public License v3.0 (or later)** — see
**[LICENSE](LICENSE)**. You are free to use, modify, and self-host; derivative
works that you distribute must also be released under the GPL.
