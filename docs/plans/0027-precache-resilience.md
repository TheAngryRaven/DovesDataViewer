# 0027 — Offline that survives a bad connection: split the precache

## Problem

Reported from a track: load the web app, enable airplane mode, refresh — nothing
loads. Same demo works on Android. Plan 0026 blamed WebKit's ~7-day storage
eviction, but that can't explain a **same-session** failure, and this turned out
not to be an iOS bug at all.

Reproduced in Chromium against a real `dist/` build, serving it over a throttled
local server and cutting the network partway through the first load:

```
SW state at cut:       { installing: 'installing', active: null }
cache entries:         53 of 267
after install failed:  { installing: null, waiting: null, active: null }
offline reload →       net::ERR_INTERNET_DISCONNECTED
```

**Workbox's precache install is all-or-nothing.** One failed request rejects
`install`, the service worker is discarded, and *nothing* is cached — the 53
entries already fetched are orphaned in a cache no worker will ever read. There
is no retry until the next page load with a working connection, and no signal to
the user that any of this happened.

The install was **10.16 MB across 267 entries**, and most of it isn't needed to
boot the app:

| | Entries | Size |
|---|---:|---:|
| Sample datalogs | 3 | 4.49 MB |
| JS chunks | 226 | 3.23 MB |
| Other images | 12 | 1.04 MB |
| Logger photos | 3 | 0.65 MB |
| wasm | 2 | 0.41 MB |
| Fonts / CSS / sim / misc | 21 | 0.36 MB |

The bundled demo datalogs alone were 44% of an all-or-nothing download. Seven
entries were also precached **twice** — `includeAssets` listed files that
`globPatterns` already matched, so the 1.25 MB sample `.nmea` was fetched twice
per install.

On a congested cell connection that is a long window in which any hiccup costs
the entire offline cache. iOS makes it worse (eviction means you re-run this
fragile install far more often) but the bug is platform-independent — Android
likely survived on a better connection, or was the native app, which has no
service worker at all.

## Design

### Keep install small; defer the heavy extras

`DEFERRED_ASSET_DIRS` in `vite.config.ts` (`samples/`, `loggers/`) is the single
source of truth. It feeds three things:

1. `globIgnores` — those directories stay out of the install-blocking precache.
2. A `CacheFirst` runtime-caching route (`app-deferred-assets`), so once present
   they are served offline exactly as if precached.
3. `offline-assets.json`, emitted at build from the filesystem by the
   `deferredAssetManifest` plugin, so the client knows what to warm. Generated
   rather than hand-maintained — dropping a new logger photo into
   `public/loggers/` needs no code change. It runs in `writeBundle`, which
   precedes vite-plugin-pwa's `closeBundle`, so the manifest is itself precached.

Only these two directories are deferred. The wasm blobs (xrk, the simulator) are
small enough to leave precached, which keeps their offline behaviour exactly as
it was — no regression risk for a marginal gain.

Result: **267 entries / 10.16 MB → 257 / 4.98 MB** install-blocking, now almost
entirely the app itself.

`includeAssets` is also cut to `["robots.txt"]` — everything else it listed was
already matched by `globPatterns`, which is where the duplicates came from.

### Warm the extras afterwards, tolerating failure

`lib/offlineWarmup.ts` reads the manifest and stores anything missing, a few at a
time, once the worker is registered. Every failure mode degrades to "less warmed"
rather than an exception: a missing manifest reads as an empty list, a rejected
store counts as `failed` and is retried next visit.

**It writes into the cache directly (`cache.add`) rather than plain `fetch`.**
The first version used `fetch` and cached nothing at all — on a first visit the
worker is registered but not yet *controlling* the page, so page-initiated
requests bypass it entirely. The integration test caught this: the
`app-deferred-assets` cache simply never appeared. `cache.add` also keeps the
per-URL partial-progress property; `cache.addAll` would have reintroduced exactly
the all-or-nothing behaviour this plan exists to remove.

The route deliberately has no `ExpirationPlugin`: entries written by the client
aren't in the plugin's own index, and a fixed set of build assets has nothing to
expire.

### Make readiness visible

The deeper failure was that none of this was observable — you found out the cache
was incomplete by losing signal and refreshing. `lib/offlineReadiness.ts` (pure)
plus `hooks/useOfflineReadiness` and a Settings row report one of
`unsupported` / `not-ready` / `preparing` / `ready`, with a *Finish download*
button. `controlled` alone decides whether the app loads offline — the shell is
precached as a unit, so a controlling worker means install completed; the
deferred count only separates "ready" from "preparing".

## Verification

`scratchpad/verify-fix.mjs` serves the real `dist/` over a byte-rate-throttled
server, cuts the connection mid-warm-up, and asserts the offline reload still
renders. Before: `ERR_INTERNET_DISCONNECTED`. After: the app renders from cache
with zero network hits.

## Not done

- **The three PWA icons are still precached twice** (globPatterns and the
  manifest injection both claim them). They're identical URLs with identical
  revisions so Workbox dedupes them; it costs nothing but reads oddly.
- **`vite.config.ts`'s `app-html` NetworkFirst route is still dead code** —
  Workbox registers the precache `NavigationRoute` first and matches in
  registration order, so navigations never reach it. Precache-first is the more
  offline-robust behaviour, so this was left alone rather than reordered.
- **Retrying a failed install.** A failed install still self-heals only on the
  next load with a connection. With install down to ~5 MB the window is much
  smaller, and the readiness row now makes the state visible, which covers the
  practical case.
