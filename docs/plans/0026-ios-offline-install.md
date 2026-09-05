# 0026 — iOS offline: tell iPhone users to install, and ask to keep the cache

## Problem

Demoing the app at a track on an iPhone with no signal produced nothing — the
site would not load offline, despite being a service-worker PWA that works
offline everywhere else.

This is not a broken service worker. Safari has supported service workers since
iOS 11.3, the generated worker precaches the whole app shell (267 entries,
~10 MB), and navigations are served from that precache, so a *warm* Safari tab
does run offline. Two WebKit policies take it away:

1. **Storage eviction.** Safari deletes all *script-writable storage* for a site
   the user hasn't interacted with for roughly seven days of browser use. That
   sweep takes the service worker registration, the Cache API precache **and**
   our IndexedDB sessions — the whole offline app, silently, with no warning
   and no fallback. A phone that last opened LapWing before the previous race
   weekend arrives at the track with nothing cached. This is the failure that
   was actually hit.
2. **No install event.** iOS never fires `beforeinstallprompt`. Our
   `InstallPrompt` component was built entirely around that event, so on iPhone
   and iPad it rendered *nothing at all* — the one platform that most needs the
   nudge was the one platform that never got it.

Adding the app to the Home Screen is the documented escape hatch: an installed
web app gets a much larger storage quota (~60% of disk vs ~20% for a bookmarked
site) and its own idle counter that only advances on days the app is actually
opened, so a month between race weekends no longer wipes it. WebKit also grants
the Storage API's persistent mode "based on heuristics like whether the website
is opened as a Home Screen Web App".

A Home Screen web app has its **own storage partition**, separate from Safari's
— installing does not inherit the tab's cache or its IndexedDB sessions. So the
instructions must end with "now open it once while you still have signal",
otherwise the user installs an icon that is just as empty at the track.

## Design

### `src/lib/pwaInstall.ts` — pure detection

`detectInstallState(env)` → `"installed" | "ios-manual" | "prompt-capable"`.

- `installed` when `navigator.standalone` (the only signal iOS Safari gives) or
  `matchMedia("(display-mode: standalone)")` matches. Checked first, so an
  already-installed app is never nagged.
- `ios-manual` for iPhone/iPad in a tab. iPad needs care: since iPadOS 13 it
  reports a desktop-class UA (`Macintosh…MacIntel`) with no iOS token, so
  `isIosDevice` falls back to "looks like a Mac **and** `maxTouchPoints > 1`".
  Desktop Safari reports 0 touch points and stays `prompt-capable`.
- `prompt-capable` for everything else — the existing `beforeinstallprompt`
  path is unchanged.

`readInstallEnvironment()` is the one impure edge (reads `navigator`/
`matchMedia`); everything above it takes a plain object and is unit-tested.

Dismissal moved from `sessionStorage` to a 30-day snooze in `localStorage`
(`isSnoozed`). The iOS hint is the difference between having telemetry at the
track and not, so "not now" should snooze rather than silence — but a month is
long enough not to nag. A corrupt or future-dated stamp reads as "not snoozed",
so a bad value can't hide the hint forever.

### `src/lib/persistentStorage.ts` — ask to keep the data

`requestPersistentStorage()` checks `navigator.storage.persisted()` first and
only calls `persist()` when it isn't already granted. Called once from
`main.tsx` on the web path (not native, not preview/iframe), fire-and-forget:
every outcome — granted, denied, no API, throwing implementation — is a return
value, never an exception.

On Safari this is granted mainly to Home Screen apps, so it mostly pays off
*after* the user follows the hint; on Chromium and Firefox it exempts the cache
and IndexedDB from eviction directly. Either way it is the correct signal to
send and costs nothing.

### `InstallPrompt.tsx`

Same card, three states: the existing install button when
`beforeinstallprompt` fires, the iOS share-sheet steps (Share → *Add to Home
Screen* → open it once with signal) plus a one-line why, and nothing when
installed or snoozed. Strings moved into `common:install.*` — the component was
the last hardcoded-English surface here — and translated across all six
non-English locales.

## Not done / considered

- **A "cached and ready for offline" indicator.** Worth having (you could check
  it in the paddock before losing signal) but it is a separate surface, not
  part of unblocking the iPhone case.
- **Nagging on desktop.** Left alone: desktop browsers don't evict this
  aggressively and the native `beforeinstallprompt` flow already works.
- **Anything server-side.** Rule 1 — this is entirely a client concern.

## Follow-up noticed while here

The `app-html` `NetworkFirst` runtime-caching route in `vite.config.ts` is dead
code: Workbox registers the precache `NavigationRoute` first and matches routes
in registration order, so every navigation is served by the precache handler
and never reaches the `NetworkFirst` route. Precache-first is the more
offline-robust behaviour, so this was left as-is rather than reordered — but
the config reads as though `NetworkFirst` governs navigations, and it doesn't.
