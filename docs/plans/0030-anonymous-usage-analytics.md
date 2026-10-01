# Anonymous usage analytics — PostHog, pageviews only, cookieless, opt-out

> Status: **LANDED** (web app), hardened after the PR #440 review (see
> *Hardening*). Follow-up: same-origin reverse proxy (see *Pending*).
>
> Numbered 0030: it was drafted as 0029, which the GoPro import plan took on
> BETA first.

## Problem

The only traffic signal for lapwingdata.com was the request count on the
Cloudflare Workers dashboard. That can't answer the questions the maintainer
actually has: how many people use the app and roughly **how long they stay**.
Mandating accounts to find out is a non-starter (offline-first, no-account core
app is the product), and the privacy policy promised "no analytics scripts,
telemetry beacons or fingerprinting", so whatever was added had to be honest,
minimal and switchable.

## Approach & key decisions

1. **PostHog, not GA4 / Plausible / Umami.** PostHog's Web Analytics dashboard
   gives visitors / session duration / bounce / referrers / countries straight
   from `$pageview` + `$pageleave`, the free tier (1M events/month) is far above
   our traffic, it has an EU cloud, and it supports a cookieless mode. GA4 sets
   cross-site cookies, needs a consent banner for EU visitors and is blocked by
   most ad blockers.

2. **Pageviews only.** `autocapture`, dead clicks, heatmaps, exception capture,
   performance capture, session replay, surveys, web experiments and feature
   flags are all disabled in `lib/analytics.ts`. Nothing app-specific is ever
   `capture()`d, and there is deliberately no `track()` helper to tempt anyone.
   If a product question ever needs an event, it gets its own plan and its own
   privacy-policy line.

3. **Cookieless (`cookieless_mode: "always"`).** Nothing is written to cookies,
   localStorage or sessionStorage. PostHog hashes IP + user agent + a salt it
   rotates daily on its servers, so a visit can be grouped into a session but
   never linked across days, to an account, or to a device. The trade-off is
   accepted on purpose: **returning visitors across days are not countable.**
   The first draft kept a persistent random id for exactly that number, and the
   review rejected it. Storing an identifier on the device is what ePrivacy
   regulates, the old policy had promised no analytics, and an opt-out default
   on top of a persistent id is the weakest possible position. Daily uniques +
   session length answer "is it used" without any of that.

4. **Opt-out, plus DNT/GPC before download, plus a one-time notice.** A
   `sendUsageStats` setting (default on) under *Settings → Privacy*; with it
   off, nothing is downloaded. `hasBrowserOptOut()` checks Do Not Track and
   Global Privacy Control **before** the dynamic import, so those browsers never
   fetch PostHog at all (`respect_dnt: true` stays on as a second layer). The
   first time analytics starts in a browser, `takeUsageStatsNotice()` lets
   `main.tsx` show a single toast saying so, so people who had the app before
   the setting existed are not opted in silently.

5. **Every URL is scrubbed before it leaves the page.** `before_send` runs
   `scrubEvent()` over the event, `$set` and `$set_once`: every property whose
   name ends in url / href / referrer / pathname / referring_domain loses its
   query string and fragment, same-origin paths have `/s/<token>` →
   `/s/:token` and `/driver/<name>` → `/driver/:username`, other sites'
   referrers are cut to their origin, and anything unparseable is dropped
   rather than sent. Document titles are dropped. Why it matters: Supabase's
   implicit auth flow puts access/refresh tokens in the URL hash on
   `/auth/callback` and `/reset-password`, and a share token *is* the access key
   to a private session. `mask_personal_data_properties` additionally masks ad
   click ids.

6. **The Settings toggle is the source of truth, and boot is the only start.**
   `initAnalytics()` (main.tsx) is the only place analytics is first started.
   `setUsageStatsEnabled()` is called by `useSettings` only when the user
   actually flips the switch (never with the mount value), and only starts the
   client on a page where boot would have: same gate, including the preview
   host. Opting out calls `opt_out_capturing` and `clearStoredIdentifiers()`,
   which also removes any `ph_*` keys/cookies a pre-hardening build left
   behind. Boot clears those too.

7. **Web only, never native, embedded or preview.** One gate,
   `shouldStartAnalytics()`, checks: key baked in, not the Tauri/Android shell,
   not an iframe, not a `?nosw=1` preview host, no DNT/GPC, setting on. Keeping
   Android out means the Google Play Data Safety form is untouched.

8. **Absent when no key is baked in, down to the bytes.** `loadClient()` opens
   with a literal `if (!import.meta.env.VITE_POSTHOG_KEY) return null`. Vite
   `define`s that constant, so in a keyless build it is `if (!"")` and Rollup
   drops the `import("posthog-js")`: no chunk is emitted. With a key, the
   `vendor-posthog` chunk is in `globIgnores`, so only browsers that actually
   run analytics download it, instead of every offline install precaching
   ~300 kB. `disable_external_dependency_loading` stops PostHog fetching scripts
   from its CDN, and `advanced_disable_flags` removes the `/flags` request.

9. **One project, channel-tagged.** Cloudflare build variables apply to every
   branch of the Worker, so beta/preview deploys would otherwise be
   indistinguishable from production. Every event carries super-properties
   `app_channel` (`production` | `preview`, from `isPreviewBuild()`),
   `app_version` and `app_display_mode` (`standalone` = installed PWA). The env
   var goes through vite's `pick()`, so `VITE_POSTHOG_KEY_PREVIEW` can instead
   point beta at a separate PostHog project.

10. **Anonymous events, no person profiles.** `person_profiles: 'identified_only'`
    and nobody is ever `identify()`d.

11. **Privacy policy is part of the change.** `pages/Privacy.tsx` gains an
    "Anonymous Usage Statistics" section (what is collected, the URL scrubbing,
    no stored identifier, the IP handling, how to switch it off), lists PostHog
    as a sub-processor, and updates Cookies & Local Storage. Each is gated on
    `isAnalyticsAvailable()`, so a keyless build still shows the original
    no-tracking wording.

### Operator setup (before setting the key)

1. In the PostHog project settings, enable **cookieless server hash mode**.
   Without it PostHog drops every cookieless event, so forgetting it fails
   closed.
2. Enable **Discard client IP data**. The policy says the IP is used for the
   coarse geo lookup and the visitor hash, then discarded. The browser cannot
   enforce this (the deprecated `ip` option is a no-op in posthog-js), so it is
   an operator promise, repeated in the README and `CLAUDE.md`.
3. Set `VITE_POSTHOG_KEY` (and `VITE_POSTHOG_HOST` for the EU cloud) as
   Cloudflare build variables and redeploy.
4. Use the **Web Analytics** dashboard, filtered on `app_channel = production`
   (or set `VITE_POSTHOG_KEY_PREVIEW` to a second project and skip the filter).

## Hardening (PR #440 review)

| Finding | Fix |
|---|---|
| Full URLs (auth tokens in the hash, `/s/:token` share keys) would be sent | `scrubEvent` in `before_send` (decision 5), unit-tested |
| `vendor-posthog` precached for every visitor, even keyless | literal-key guard drops the import; chunk in `globIgnores` (decision 8) |
| `useSettings` mount effect could start PostHog on `?nosw=1` previews | change-only effect + single gate incl. preview host (decisions 6, 7) |
| Persistent id + opt-out default = ePrivacy exposure; existing users opted in silently | cookieless mode + one-time notice (decisions 3, 4) |
| Policy's "IP not retained" not enforced anywhere | operator checklist in README / CLAUDE.md / here; wording says it's a project setting |
| Plan number 0029 collided with GoPro import | renumbered 0030 |
| Opt-out left the `ph_*` cookie and id behind | nothing stored any more; `clearStoredIdentifiers()` on boot and opt-out removes legacy ones |
| Opt-in/opt-out bridge untested | `analytics.test.ts` mocks `posthog-js` and covers boot, gates, toggles, scrubbing |
| Credits named the service, not the library | `posthog-js` (MIT / Apache-2.0) in README + CreditsDialog |

## Touch points

- `src/lib/analytics.ts` (+ `analytics.test.ts`): config, gate, DNT/GPC check,
  URL scrubbing, legacy-id clearing, one-time notice flag, lazy client,
  opt-in/out bridge.
- `src/main.tsx`: `initAnalytics()` beside the SW registration, plus the notice
  toast.
- `src/hooks/useSettings.ts`: `sendUsageStats` (default true) and a change-only
  effect → `setUsageStatsEnabled`.
- `src/components/SettingsModal.tsx`: *Privacy* section, shown only when
  available.
- `src/locales/*/settings.json` (`privacy.*`) and `src/locales/*/common.json`
  (`usageStatsNotice.*`).
- `src/pages/Privacy.tsx`: policy sections; `CreditsDialog.tsx` + README
  credits.
- `vite.config.ts` (`define` via `pick()`, `vendor-posthog` chunk +
  `globIgnores`), `src/vite-env.d.ts`, README env tables + operator checklist,
  `CLAUDE.md`.

## Pending / follow-ups

- **Same-origin reverse proxy.** Ad blockers block `*.i.posthog.com`; the fix is
  routing `/ingest/*` through our own domain. The site is a static-assets Worker
  today (no `main` script), so this means adding a small fetch handler with
  `run_worker_first` for that path and pointing `VITE_POSTHOG_HOST` at it. That
  Worker could also drop the client IP before forwarding, which would make the
  IP promise enforceable in code instead of a project setting.
- Revisit whether beta should get its own PostHog project once real traffic
  shows how noisy the shared-project filter is.
