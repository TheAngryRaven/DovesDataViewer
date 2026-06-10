# Professional Codebase Review — 2026-06-10

A deep multi-agent review of the entire codebase at commit `d27651a` (v2.3.1),
judged against professional standards where 10/10 is a flagship project
(Linux-kernel class — unattainable for a solo developer). Six parallel reviews
were performed: architecture/coupling, security, performance, testing/CI, data
correctness, and FOSS/GPLv3 hygiene. Every finding below was verified against
the actual source (and where relevant, a real production build and a full test
run: 102 files, 1,353 tests, all green).

## Overall score: **5.5 / 10**

| Area | Score | One-line verdict |
|---|---|---|
| Security | 7/10 | RLS everywhere, real webhook verification — held back by CRC-only firmware OTA |
| Data correctness | 6/10 | Flagship path is solid; VBO/AiM/Alfano long-tail produces confidently wrong data |
| FOSS / GPLv3 hygiene | 6/10 | Governance files & release discipline above median; no copyright holder named anywhere |
| Architecture | 5/10 | Clean pure lower layers; god-object application layer with a 71-field context |
| Testing / CI | 5/10 | Excellent unit layer over ~half the risk surface; zero integration/E2E; hooks at 1% |
| Performance | 4/10 | Crashes and freezes at exactly the data sizes the product advertises |

**The shape of the project:** the pure-logic lower layers (`lib/` parsers,
lap math, channels, units, the plugin seam, the XRK worker pipeline, the
Supabase backend) are genuinely well-engineered — tested, decoupled, zero
circular imports across 395 modules. The application layer above them —
orchestration, rendering, error handling — is where the professional bar is
missed: god components, a per-frame re-render architecture, undecimated canvas
drawing, and a correctness long-tail in the secondary parsers that produces
**wrong lap times and speeds**, the worst possible failure mode for a timing
tool.

---

## CRITICAL — wrong data, crashes, or structural risk. Fix first.

- [ ] **CR-1. VBO time parsing is wrong for the standard Racelogic format — corrupted lap times.**
  `src/lib/vboParser.ts:69-87`. Racelogic stores `time` as UTC `HHMMSS.SS`.
  (a) Any session before 10:00:00 UTC falls into the "seconds since midnight"
  branch: `095559.00 → 95559` vs `095600.00 → 95600` — every minute boundary
  injects ~40 phantom seconds. (b) Times ≥ 100000 use `padStart(10,'0')` which
  assumes 3 decimals; 2-decimal values parse non-monotonically (time runs
  backwards at 10-minute boundaries), spuriously triggering the midnight +24 h
  patch at line 206. The unit test only feeds tiny seconds-since-midnight
  values, so neither failure is covered. *"Morning session in Europe" is not an
  edge case.*

- [ ] **CR-2. VBO coordinates: Racelogic decimal-minutes format and west-positive longitude are not handled — race line lands ~2,300 km off.**
  `src/lib/vboParser.ts:90-109`. Racelogic stores lat/long in total decimal
  minutes (`+03119.09973` = 51.985°N); the parser reads it as `DDDMM.MMMMM` →
  31.318°. Values ≤ 180 are taken as decimal degrees (wrong, and inconsistently
  per axis). The longitude-positive-west convention is ignored — no sign flip,
  so eastern/western hemispheres mirror. Only RaceBox-style signed-decimal
  exports parse correctly. Add real Racelogic fixture files.

- [ ] **CR-3. AiM CSV speed-unit heuristic decided by a single sample — all speeds ×3.6.**
  `src/lib/aimParser.ts:246-250`. If the first GPS-valid row is moving at
  1–29 (km/h) — i.e. rolling out of the pits, the common case — the whole file
  is declared m/s, so 100 km/h becomes 224 mph. Wrong top speeds, braking
  zones, and waypoint detection. Decide units from the header or from a
  statistic over many samples, never one row.

- [ ] **CR-4. `Math.max(...array)` spread crashes charts above ~65–125k samples.**
  `src/components/TelemetryChart.tsx:172,265-266,305-306`;
  `src/components/graphview/SingleSeriesChart.tsx:202-203,209-210,218-219`.
  Spreading a 100k-element array throws `RangeError: Maximum call stack size
  exceeded` (limit as low as ~65k on mobile Safari). Opening All Laps on a
  2-hour 20 Hz session with the range expanded = blank crashed chart. Replace
  with a plain loop (it also runs inside the draw effect on every cursor tick).

- [ ] **CR-5. Leaflet heatmap builds one SVG DOM polyline per GPS segment.**
  `src/components/RaceLineView.tsx:414-421`,
  `src/components/graphview/MiniMap.tsx:175-178`. No `preferCanvas`, so the
  default SVG renderer emits one `<path>` node per sample pair. The 1,500-sample
  crop is the only thing saving it; a full-session range at 60 Hz attempts tens
  of thousands of DOM nodes — multi-second freeze, dead tab on pan/zoom. The
  layer group is also torn down and rebuilt on every range-slider movement.
  Fix: one canvas-rendered polyline per color bucket (~20 layers) or a custom
  canvas layer. The bug is duplicated in MiniMap, so Pro mode pays twice.

- [ ] **CR-6. Playback cursor re-renders the entire tree and fully redraws every canvas, every tick.**
  `src/pages/Index.tsx:121-126,347-442` + draw-effect deps at
  `TelemetryChart.tsx:493`, `SingleSeriesChart.tsx:398`, `GGDiagram.tsx:250`.
  `currentIndex` is a dep of the 71-field `sessionContextValue`, so every
  `useSessionContext` consumer re-renders at playback rate (the `memo()` on
  tabs is bypassed by context). There is no cursor layer: a 1px cursor move
  re-clears and redraws grid + main line + reference + every overlay + G-G
  clouds, with `canvas.width` reassigned per draw (buffer reallocation), and no
  decimation anywhere (one `lineTo` per sample regardless of pixel width).
  Fix: static layer + cheap cursor overlay (second canvas / cached bitmap),
  per-pixel min/max decimation, and split the cursor out of the big context.

- [ ] **CR-7. Bus factor of one, with zero independent review.**
  `git shortlog`: Claude (AI) 167 commits, one pseudonymous human maintainer
  who authors, reviews, and self-merges every PR — for a project that ships
  **OTA firmware to physical hardware** and handles **Stripe billing + GDPR
  deletion**. Not code-fixable, but mitigations exist: recruit a co-maintainer,
  require review on release-tagged PRs, add CODEOWNERS, document a succession/
  recovery contact.

---

## HIGH — exploitable, user-visible wrongness, or load-bearing debt

### Security

- [ ] **H-1. Firmware OTA images are authenticated only by TLS + CRC-32 — not signed.**
  `src/lib/ble/dfu/firmwareManifest.ts:15-20`, `src/lib/ble/firmwareCrc.ts`,
  `firmwareUpload.ts`. The manifest supplies its own CRC; CRC-32 is error
  detection, not authentication. The entire trust boundary is "GitHub Pages
  account + TLS" — a compromised repo/account (or a malicious
  `VITE_FIRMWARE_MANIFEST_URL` at build time) flashes attacker firmware onto
  hardware. Sign images (Ed25519/ECDSA), verify on-device against a pinned
  public key; keep CRC for transport integrity only. Highest-impact gap in the
  codebase.

- [ ] **H-2. Open redirect in `/auth/callback` via the `next` param (confirmed by dependency advisory).**
  `src/pages/AuthCallback.tsx:16,21` does `navigate(params.get('next') || '/')`;
  the pinned `react-router-dom` 6.x is flagged for GHSA-2j2x-hqr9-3h42
  (protocol-relative `//evil.com` redirect). Bump the router **and** validate
  `next` is an internal path (single leading `/`, reject `//` and schemes).

### Data correctness

- [ ] **H-3. UBX `startDate` uses the local-time `Date` constructor on UTC fields.**
  `src/lib/ubxParser.ts:189` — `new Date(pvt.year, …)` shifts the session epoch
  by the browser's UTC offset (±14 h worst case): wrong file-browser names,
  wrong weather hour. The NMEA parser does it correctly with `Date.UTC()`
  (`nmeaParser.ts:275`); the two parsers disagree for the same hardware.

- [ ] **H-4. The documented 25% course-length tolerance is never enforced.**
  `src/lib/courseDetection.ts:39` — `LENGTH_MATCH_TOLERANCE` is declared and
  never referenced. `autoDetectCourse` accepts any course producing ≥1 lap
  (including `lengthDiff: Infinity` candidates) and just sorts. A 400% length
  mismatch gets tagged as that course with the wrong sector lines, instead of
  falling back to waypoint mode as CLAUDE.md and the module docstring promise.

- [ ] **H-5. Alfano time-unit heuristic is per-row — mixed units within one file.**
  `src/lib/alfanoParser.ts:221` — `timeVal > 100000 ? timeVal : timeVal*1000`.
  A ms-based column multiplies the first 100 s by 1000, then collapses; time
  goes backwards and the midnight patch (line 230) adds a fake day. Decide the
  unit once per file, not per row.

- [ ] **H-6. Native g-force channels silently clobbered / dropped when only one axis is present.**
  `src/lib/aimParser.ts:337-340` (+ keys at 276, 281): native `acc_lat`/`acc_long`
  stored as `'Lat G'`/`'Lon G'`; if only one column exists, the GPS derivation
  overwrites **both** (`gforceCalculation.ts:90-91`) — also violating the
  `lat_g_native` contract in `channels.ts`. Inverse bug in
  `src/lib/motecParser.ts:177` (native Lat G but no Lon G → no longitudinal g
  at all). Same overwrite path in `src/lib/xrk/xrkMapping.ts:155-162`.

### Performance

- [ ] **H-7. `averageFrameRate` does an O(n log n) sort on every render of Index.**
  `src/hooks/usePlayback.ts:37-57` — `useCallback(...)()` IIFE memoizes the
  function, not the result; every playback tick re-diffs and re-sorts the full
  visible sample window (~10–20 ms/frame at 100k samples) for a constant value.
  Make it `useMemo`.

- [ ] **H-8. `usePlayback`'s rAF loop tears itself down every tick.**
  `src/hooks/usePlayback.ts:85-147`. `animate` depends on `currentIndex`; each
  index change cancels/recreates the rAF and resets the timing anchors, so
  playback advances at most one frame per two rAF frames and constantly
  re-anchors its clock — 60 Hz data cannot play at real time. Move loop state
  into refs; never re-subscribe on index changes.

- [ ] **H-9. Map position marker destroyed/recreated per tick; MiniMap re-issues an animated `panTo` per tick.**
  `src/components/RaceLineView.tsx:525-556`, `MiniMap.tsx:217-230`. Every
  cursor tick: `removeLayer` → build SVG string → `L.divIcon` (innerHTML parse)
  → new marker → `addTo`. MiniMap's `panTo(…, {animate: true, duration: 0.15})`
  per 16 ms tick perpetually self-interrupts. Use `marker.setLatLng()` + rotate
  the existing icon element; throttle/de-animate `panTo`.

- [ ] **H-10. O(glitches × n) allocation inside SingleSeriesChart's draw loop.**
  `src/components/graphview/SingleSeriesChart.tsx:294-296` — maps the entire
  sample array once per glitch index, per redraw, per cursor tick (200 glitches
  × 10k samples = 2M allocations per redraw). Hoist the loop-invariant array
  (TelemetryChart already does).

- [ ] **H-11. Video export holds the whole MP4 and whole decoded audio in memory; no encoder backpressure.**
  `src/lib/videoExport.ts:259-276` (`ArrayBufferTarget` + in-memory fastStart:
  a 20-min 15 Mbps export ≈ 2.2 GB buffer — guaranteed mobile OOM, no duration
  guard); `:76-118` (fetches the entire source video + expands full audio to
  PCM just to re-encode); `:336` (`encoder.encode` with no `encodeQueueSize`
  check). Use a chunked/`FileSystemWritableFileStream` target and bounded queue.

- [ ] **H-12. The "small initial bundle" is a caching strategy, not a loading one — ~1.13 MB raw / ~334 kB gzip on the landing page.**
  Verified from a real build. `vendor-leaflet` (150 kB) is eager because
  `RaceLineTab`/`RaceLineView`/`TrackEditor` are statically imported by
  `Index.tsx`; `vendor-supabase` (174 kB) is eager via `AuthProvider` in
  `App.tsx` even with cloud/admin both off (acknowledged as a "known follow-up"
  in CLAUDE.md — it's the single biggest dead weight on the offline-first
  path). Lazy-load RaceLine/TelemetryChart behind the existing tab pattern;
  gate the auth bootstrap on the env flags.

### Architecture

- [ ] **H-13. `SessionContext` is a 71-field grab-bag — and the prop drilling it was meant to kill is still there.**
  `src/contexts/SessionContext.tsx:25-128` (71 fields incl. 20 callbacks; its
  own comment at :21-23 admits the halfway state). Meanwhile `RaceLineTab`
  drills 29 props into a 33-prop `RaceLineView`; `GraphViewTab` passes 46 props
  to a 47-prop `GraphViewPanel`; `FileManagerDrawer` takes 38 props assembled
  in `Index.tsx:445-495` with a ~60-entry useMemo deps array. The codebase pays
  for both patterns. Split into focused contexts (playback / laps / overlays /
  catalog) or adopt a selector-based store (Zustand/Jotai) — the project is
  past the scale where hand-threaded React state is the right tool. (Fixing
  this is also the structural half of CR-6.)

- [ ] **H-14. `Index.tsx` is a god orchestrator whose invariants live in wrapper callbacks.**
  `src/pages/Index.tsx` (721 lines, 19 custom hooks, 12 useMemo, 8 useCallback).
  Lines 211-255: four hand-written wrappers exist solely to enforce "reference
  lap / external ref / active snapshot are mutually exclusive" by manually
  calling the other hooks' clear-setters — the invariant exists nowhere as a
  model, and any future direct caller of `handleSetReference` silently
  desynchronizes state. `handleSetOverlayReference` even string-parses overlay
  IDs (`line.id.startsWith('lap:')`, :228) in the page component — dispatch
  that belongs in `lib/lapOverlays.ts`. Introduce a reducer/domain model for
  the comparison-source state.

- [ ] **H-15. Hooks are not "one concern each" — they mutate each other through raw setters and take whole hook instances as parameters.**
  `src/hooks/useDataLoader.ts:16-19` accepts three entire hook instances
  (`ReturnType<typeof useSessionData>` etc.) and drives their raw setters
  (:102, :127, :142-144, :164-171). `useLapManagement` mixes selection state
  with unawaited persistence (`updateFileMetadata` at :76-80, :95-99), and the
  raw `setSelection`'s no-persist asymmetry is documented in *another module's*
  comment (`useDataLoader.ts:172-175`). `useSessionData.ts:59-92` hardcodes
  business policy ("Orlando Kart Center", magic lap numbers 8/11) in a core
  hook. `useReferenceLap` takes 10 positional parameters. Snapshot state is
  co-owned by three modules via `externalRef.setExternalRefSamples(...)` calls
  from `Index.tsx:176-180,213-214,235-236`.

- [ ] **H-16. Layering inversions: `lib/` imports from `components/` and `hooks/`.**
  `lib/videoStorage.ts:7-9`, `lib/videoExport.ts:16-17` (an export engine
  depending on a **dialog component's** type), `lib/overlayCanvasRenderer.ts:7-12`,
  `lib/setupStatus.ts:1`. Root cause: ~6 pure, tested logic modules
  (`registry.ts`, `themes.ts`, `dataSourceResolver.ts`, `sectorUtils.ts`,
  `overlayUtils.ts`, `types.ts`) are misfiled under `components/video-overlays/`.
  Move them into `lib/` and the inversions disappear. Also `lib/dbUtils.ts:106-164`:
  the generic IDB infra module contains kart-domain migration logic with
  hardcoded field names — infra knowing domain schema is upside-down.

### Testing / CI

- [ ] **H-17. The IndexedDB upgrade path — the thing guarding every existing user's offline data — is never tested.**
  All IDB tests call `freshIndexedDB()` and create the DB at v12 from scratch;
  the `oldVersion < 8` kart migration (`dbUtils.ts:96-115`, with a swallowed
  `catch {}`) and every v1..v11→v12 path never execute against a pre-populated
  old DB. fake-indexeddb makes this trivially testable. A botched migration
  bricks every user — the single worst test gap given Golden Rule #1.

- [ ] **H-18. The hooks layer is a 1,290-line coverage dead zone (1.0%).**
  27 of 28 hooks have zero tests — `useVideoSync` (255 ln), `useFirmwareUpdate`
  (111), `usePlayback` (83), `useLapManagement` (79), `useReferenceLap` (76)
  are the orchestration spine of the app. Whole-codebase effective coverage is
  ~25-30% (the 57.9% headline excludes 22,723 lines — 48.5% of the codebase).

- [ ] **H-19. `lib/overlayCanvasRenderer.ts` (677 ln) and `lib/videoExport.ts` (551 ln) at 0% coverage; `plugins/cloud-sync/autoSync.ts` at 0%.**
  The canvas math feeding video export ships silently broken if it regresses;
  the sync *engine* is tested but the thing that triggers it (debounce,
  garageEvents wiring, tombstone-skip) is not.

- [ ] **H-20. Zero integration tests, zero E2E, zero visual regression.**
  No `@testing-library/react` usage anywhere (test env is `node`, not jsdom);
  no Playwright/Cypress; no pixel/snapshot tests for three hand-rolled Canvas
  2D charts. For a PWA whose core promise is offline-first, nothing verifies
  the service worker, precache, or IndexedDB persistence in a browser. The
  vitest.config comment justifying the view-layer exclusion ("validated by
  integration/visual testing") describes testing that does not exist.

- [ ] **H-21. CI actions use floating tags, not SHA pins — including a third-party action that receives a PAT.**
  All five workflows use mutable tags; `Schneegans/dynamic-badges-action@v1.7.0`
  (`coverage.yml:97`) gets `secrets.GIST_TOKEN`. A compromised tag exfiltrates
  the token. Pin to commit SHAs (dependabot still updates them).

### FOSS / GPLv3

- [ ] **H-22. No copyright notice anywhere in the project.**
  `grep -r "Copyright"` over all project files returns nothing — not in
  LICENSE, README, or any source file. GPLv3's "How to Apply These Terms"
  requires one; without a named holder, GPL enforcement is legally hamstrung
  and downstream attribution is impossible. Add `Copyright (C) <year> <holder>`
  to LICENSE/README and headers to at least the entry points.

- [ ] **H-23. The plugin architecture is explicitly designed for proprietary substitution into a GPLv3 bundle — a latent GPL violation.**
  Today's published `@perchwerks/eye-in-the-sky` is GPL-3.0-or-later (verified),
  so the current combined work is compliant. But `src/plugins/README.md` and
  `.gitignore` describe a "**private** coach plugin" flow, and
  `DOVE_PLUGIN_PACKAGES` statically bundles any package into the served JS
  (`vite.config.ts:67-188`) — serving that bundle is conveying under GPLv3, so
  a proprietary plugin build of hackthetrack.net would violate the license.
  Document that bundled plugins must be GPL-compatible and correct the
  "private plugin" language.

---

## MEDIUM — fix as you touch the area

### Correctness

- [ ] **M-1.** NMEA checksums never validated (`nmeaParser.ts` — `split(',')`
  with no `*hh` check; UBX validates Fletcher-8, NMEA doesn't, and the code
  already defends the heading field against corruption it lets through for
  lat/lon/speed).
- [ ] **M-2.** iRacing session time-of-day ignored — `iracingParser.ts:171,291`
  reads only `sessionStartDate`; every `.ibt` displays "…12:00 AM" and weather
  fetches the wrong hour. Read the `sessionStartTime` double at sub-header
  offset 8.
- [ ] **M-3.** `updateFileMetadata` read-merge-write spans two IDB transactions
  (`fileStorage.ts:144-158`) — concurrent patchers (track tag, weather cache,
  fastest-lap cache) lose updates; `saveFileMetadata` (:133-135) swallows all
  errors incl. quota and still returns "merged". Make it one transaction and
  surface failures.
- [ ] **M-4.** UBX accepts fixType 5 (time-only fix, stale position) —
  `ubxParser.ts:141`; `flags.gnssFixOK` read but never checked.
- [ ] **M-5.** GPS-derived g hard-clamped at ±3 g (`gforceCalculation.ts:21`) —
  flattens the G-G diagram for the iRacing path (GT3 braking, formula lateral
  exceed 3 g).
- [ ] **M-6.** UBX detection false-positive hard-fails the load —
  `ubxParser.ts:263-268` claims any file with `0xB5 0x62` in the first 200
  bytes, then throws instead of letting the router fall through.
- [ ] **M-7.** Prime-meridian data dropped: `nmeaParser.ts:98` and
  `ubxParser.ts:181` reject `lat === 0 || lon === 0` (either axis) — UK tracks
  on Greenwich longitude silently lose samples; shared `validateGpsCoords`
  already does it right (both-zero).
- [ ] **M-8.** No file-size guard: `datalogParser.ts:66,90` holds the file as
  both ArrayBuffer **and** text — multi-GB file = mobile OOM with no
  user-facing error.

### Security

- [ ] **M-9.** `submissions.course_data` stored as unvalidated jsonb with no
  per-field byte cap (`supabase/functions/submit-track/index.ts:42-88,177-191`);
  Turnstile silently disabled when `TURNSTILE_SECRET_KEY` is unset; only
  backstop is a distributable per-IP limit. Whitelist keys + cap serialized
  size.
- [ ] **M-10.** IP-based rate limiting is the sole abuse control and is
  rotation/spoof-prone; `check-login-rate` fails open on any error
  (`index.ts:89-91`) and resets the counter on lockout (:69). Prefer
  per-account limits where a user exists; treat `x-forwarded-for` as untrusted.

### Performance

- [ ] **M-11.** Draw effects re-fire on every parent render:
  `TelemetryChart.tsx:121-122` rebuilds `enabledFields` per render (no
  `useMemo`) inside the draw-effect deps; `samples.map(getSpeed)` computed
  twice per redraw (:171, :222), `detectSpeedGlitchIndices` per redraw (:223),
  `fieldMappings.findIndex` per field per draw (:270, :480).
- [ ] **M-12.** `calculateDistanceArray` recomputed all over the hot path
  (`referenceUtils.ts:31-47`) — per overlay per chart card (6 cards × 5
  overlays = 30 full passes per range change), again in `buildChartAxis`
  per chart (`chartAxis.ts:124,136`), again in `Index.tsx:279-282`. Compute
  once per sample array and share.
- [ ] **M-13.** Text parsers churn ~3-4× file size in transient strings
  (whole-file `split(/\r?\n/)` + per-row `split(',').map(trim)`), and the
  `GpsSample`-object-with-nested-`extraFields` model retains ~30-50 MB at 100k
  samples. The XRK path (`xrkResample.ts`, `Float64Array` struct-of-arrays in
  a worker) is the in-repo template for fixing the rest.
- [ ] **M-14.** Export overlay renderer does O(n) work per encoded frame —
  `overlayCanvasRenderer.ts:357-447` rescans all samples for bounds and
  redraws the full track polyline every frame; `resolveRange`
  (`dataSourceResolver.ts:141-165`) rescans per overlay per frame. Cache the
  constants/bitmap; it's the difference between 2× and 10× realtime export.
- [ ] **M-15.** IDB patterns: `listFiles()` materializes every stored **blob**
  just to list names (`fileStorage.ts:68-80` — use a key cursor or the
  metadata store); every storage call opens/closes a fresh DB connection;
  `useLapOverlays.ts:51` caches full parsed sample arrays per external file
  with no cap (~100-250 MB pinned comparing 5 sessions).
- [ ] **M-16.** `fitBounds` re-fires inside the race-line rebuild effect on
  every range-slider movement (`RaceLineView.tsx:400`, `MiniMap.tsx:169`) —
  yanks the viewport while rebuilding the layer group.

### Architecture

- [ ] **M-17.** Rendering-layer duplication: ~250-300 lines of chart chassis
  duplicated between `TelemetryChart` and `SingleSeriesChart` (ResizeObserver,
  DPR scaling, grid, gap-aware polyline, tooltip, five identical mouse/touch
  handlers, the overlay alignment memo); `getSpeedColor`/`createArrowIcon`/
  `createSpeedEventIcon`/`mapStyleConfig` copy-pasted verbatim between
  `RaceLineView.tsx:23-150` and `MiniMap.tsx:15-43`; and every video overlay
  implemented twice (9 DOM widgets + 9 parallel `draw*` functions in
  `overlayCanvasRenderer.ts:94-592`, with the renderer admitting it draws
  "simplified versions" — preview and export are *known* to diverge). Extract
  a `useCanvasChart` core, a shared map-helpers module, and render both
  overlay paths from one canvas implementation.
- [ ] **M-18.** No error-handling strategy: 53 silent/comment-only `catch`
  blocks, 65 stray `console.*` calls in non-test source, 28 files
  independently toasting, critical metadata writes fire-and-forget
  (`useLapManagement.ts:76,95`, `useDataLoader.ts:115,177`) — a quota or
  private-browsing IDB failure silently produces an untagged session. Only
  `PluginPanelHost` has error boundaries; a throw in a chart draw effect takes
  down the whole SPA. Define a strategy: error boundaries around tabs, an
  awaited+surfaced persistence path, one toast/logging seam.
- [ ] **M-19.** Remaining god components: `VisualEditor.tsx` (980 ln, 13
  useState, raw `fetch` geocoding at :330), `DeviceTracksTab.tsx` (702 ln —
  multi-step BLE transactions like delete-course = download→mutate→delete→
  re-upload at :165-181 and `handleResyncAll` at :245-277 live inline with no
  mid-sequence recovery), `VideoPlayer.tsx` (727 ln — player + overlay editor
  + export orchestrator), `TrackEditor.tsx` (669 ln).
- [ ] **M-20.** 14 `*Storage.ts` modules re-roll IDB promise wrapping that
  `withReadTransaction`/`withWriteTransaction` exist for (e.g.
  `noteStorage.ts:36-47`); legacy kart/vehicle naming smeared across layers
  (`karts` store holding `Vehicle`s, 2-line shim files, `sessionKartId`
  everywhere).

### Testing / CI

- [ ] **M-21.** Only 2 real fixture files for ~10 parsers — Dove/dovex/VBO/
  Alfano/MoTeC tests are synthetic strings built by the test itself, encoding
  the parser's assumptions rather than the format spec (exactly how CR-1/CR-2
  survived a green suite). Collect real vendor files; add corrupt/truncated
  corpus + property-based tests (`fast-check`) for binary parsers.
- [ ] **M-22.** No timezone/DST/midnight-crossing tests anywhere (one trivial
  formatting case) — a real bug class for a GPS app (see H-3, M-2).
- [ ] **M-23.** Node version inconsistency: CI runs Node 22, `.nvmrc` pins 20
  (the actual production build env), README says "18+", no `engines` field —
  CI tests a different major than what ships.
- [ ] **M-24.** No `permissions:` block in 4 of 5 workflows (inherit default
  token); no CodeQL/security scanning; no release automation or provenance;
  no CODEOWNERS.
- [ ] **M-25.** The committed wasm binary is trusted, never verified in CI —
  no rebuild, no checksum against the pinned libxrk rev; a backdoored binary
  that still parses passes CI. Related: `xrk-wasm/.gitignore` deliberately
  excludes `Cargo.lock` and the toolchain is unpinned, so the binary is not
  byte-reproducible (also a GPL corresponding-source weakness — commit
  Cargo.lock, pin the toolchain, verify hash in CI).
- [ ] **M-26.** Real wall-clock sleeps in tests: `firmwareUpload.test.ts:119`
  races a 400 ms watchdog with a real 720 ms sleep on shared CI runners (the
  same file uses fake timers elsewhere); smaller sleeps in `trackSync`,
  `fileTransfer`, `setupStorage`, `fileStorage` tests.

### FOSS / docs

- [ ] **M-27.** No SPDX identifiers / license headers in any of ~500 source
  files (REUSE/GPL best practice — files copied out of the repo lose their
  license context).
- [ ] **M-28.** `THIRD-PARTY-NOTICES.txt` names the statically-linked Rust
  crates but omits their license texts / Apache-2.0 NOTICE content — Apache-2.0
  §4 requires the text accompany binary redistribution.
- [ ] **M-29.** README rot: the Philosophy section still claims "no accounts,
  no cloud sync" 130 lines above the shipped accounts/Stripe tiers;
  `VITE_ENABLE_REGISTRATION` in the deploy table does not exist in the
  codebase (the real flag is `VITE_ENABLE_CLOUD`); clone URL is a wrong-name
  placeholder.
- [ ] **M-30.** Dual lockfiles committed (`bun.lock` 212 kB + `package-lock.json`
  428 kB) — two install graphs that can silently diverge; CI uses npm. Pick one.
- [ ] **M-31.** Unsigned supply chain end-to-end: unsigned commits, unsigned
  tags, no release artifacts/attestation — notable for an app that
  auto-updates a PWA and feeds OTA firmware from a fetched manifest.
- [ ] **M-32.** SECURITY.md's only disclosure path is GitHub contact with a
  pseudonymous solo maintainer — add an email and a fallback.

---

## LOW — paper cuts and polish

- [ ] **L-1.** VBO and Alfano never set `startDate` (`vboParser.ts:157`
  declared/unused; `alfanoParser.ts:194` detects the `Date:` row but never
  parses it) → file browser falls back to raw filenames.
- [ ] **L-2.** NMEA field mappings frozen from the first valid row
  (`nmeaParser.ts:292-304`) — a column empty on row 1 is unmapped for the file.
- [ ] **L-3.** AiM start date parsed via locale-dependent
  `new Date("Sunday, December 15, 2024 1:34 PM")` (`aimParser.ts:130`) —
  non-English RaceStudio exports always lose their timestamp.
- [ ] **L-4.** Heading hygiene: Dove accepts un-normalized 360
  (`doveParser.ts:215`); AiM/MoTeC headings stored with no range/unit check
  (`aimParser.ts:313`, `motecParser.ts:160`).
- [ ] **L-5.** Waypoint sector falsy-zero bugs: `!s1Time` /
  `if (s1Time && s2Time)` treat a legitimate 0 ms crossing as missing
  (`courseDetection.ts:268-277`).
- [ ] **L-6.** `.dove` detection expires 2033-05-18 (timestamp window
  1.5e12–2.0e12, `doveParser.ts:56`); NMEA year is `2000 + yy`
  (`nmeaParser.ts:49`).
- [ ] **L-7.** `courseDetection.ts:136` comment says "sort by laps, then
  length"; code sorts length first.
- [ ] **L-8.** `parseIracingFile` relies on `isIracingFormat` for its bounds
  sanity caps (`iracingParser.ts:159-205` vs `:144-145`) — safe today via the
  router, fragile for any future direct caller (div-by-zero / multi-million-row
  loop on a crafted `.ibt`). Duplicate the `bufLen > 0` guard in the parser.
- [ ] **L-9.** esbuild dev-server advisory (GHSA-67mh-4wv8-2f99) via vite —
  dev-only; patch when convenient.
- [ ] **L-10.** Keep `bindTooltip(courseName)` text-only
  (`admin/CoursesTab.tsx:143`) — the one place community-submitted names reach
  a Leaflet HTML sink; never switch to `{ html: true }`.
- [ ] **L-11.** `GGDiagram` redraws both full clouds (cursor-invariant,
  potentially 100k `fillRect`s) per tick — trivially cacheable as a bitmap.
- [ ] **L-12.** `droppedPacketInfo` rebuild+sort per samples change with median
  logic duplicated from `usePlayback` (`RaceLineView.tsx:212-243`); speed
  events computed twice when window == full lap.
- [ ] **L-13.** Repo cruft: `full-app-description.md` is an empty 0-byte file;
  `.lovable/plan.md` is scaffolding residue — both violate CLAUDE.md's own
  "no Lovable scaffolding" rule. The 3.1 MB `test.xrk` fixture bloats clone
  size forever (Git LFS candidate).
- [ ] **L-14.** shadcn/ui vendored files (26 in `src/components/ui/`) carry no
  MIT notice/origin comment — README credit only.
- [ ] **L-15.** Changelog/tag nits: 2.3.0 has two `### Added` sections; first
  tag is `V1.0.0` (casing breaks tag sorting); no automation checks
  tag == package.json == changelog.
- [ ] **L-16.** Stale CI comment: `coverage.yml:36` claims the gate is
  "currently 1%"; actual is 50%.
- [ ] **L-17.** CLAUDE.md ships profanity in a public repo whose own quality
  section says "Keep it professional" — corporate OSPO adopters will notice.
- [ ] **L-18.** 5× duplicated checkout+`npm ci` across parallel workflows per
  push (cached, cosmetic); CI never compile-checks the `VITE_ENABLE_CLOUD=true`
  permutation.

---

## What genuinely holds up (for calibration, kept short)

- **Backend security**: RLS on every table, service-role-write-only on
  privilege-sensitive tables, real Stripe signature verification + idempotency,
  OTP-gated account deletion, server-side admin checks, no committed secrets.
- **Pure-logic lower layers**: `lapDelta` (the strongest module in the
  pipeline), `lapCalculation` (96% coverage, real edge cases), `channels`,
  `units`, `fileBrowserTree`, the parser-utils sharing, zero circular imports
  across 395 modules (madge-verified).
- **The XRK pipeline**: worker + `Float64Array` transferables + single-pass
  resampling, exercised by a real 3.1 MB golden fixture through the committed
  wasm — the engineering template the rest of the parsers should copy.
- **The plugin seam**: genuinely one-directional; cloud code stays out of core.
- **Unit-test discipline where it exists**: byte-accurate synthetic `.ibt`
  builders, mock-BLE that actually simulates the protocol, sync-engine
  conflict-resolution tests, fake-indexeddb storage tests.
- **OSS mechanics**: CONTRIBUTING/CoC/SECURITY/templates/dependabot present and
  substantive; Keep-a-Changelog actually kept; every version tagged + released.

## Suggested attack order

1. **Correctness criticals (CR-1..CR-3)** — wrong lap times/speeds destroy the
   product's reason to exist; add real vendor fixtures with each fix (M-21).
2. **Crash/freeze criticals (CR-4..CR-6)** — spread-crash is a one-line fix;
   the heatmap and cursor work are contained, well-understood rewrites.
3. **H-1 firmware signing + H-2 router bump** — the two security items with
   real-world blast radius.
4. **H-17 IDB upgrade-path tests** before the next `DB_VERSION` bump.
5. **H-13/H-14/CR-6 state refactor** as one project (split context or store) —
   it unlocks the performance ceiling and de-gods Index.tsx simultaneously.
6. **H-22 copyright + M-27/M-28 notices** — an afternoon of legal hygiene.
7. Work the Medium list opportunistically as those files are touched.
