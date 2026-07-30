# 0014 — GPS quality filtering (all formats) + "hardcore" speed filtering setting

## Problem

An AiM Solo2 user imported an `.xrk` session recorded with 95–99% GPS packet
loss. Errant fixes survived parsing and corrupted every downstream feature:
race-line spikes miles off track, a 134.49 mi session distance, a 735 mph max
speed, and impossible chart-tooltip values (`Satellites: -1597.4`,
`GPS_pDOP: 275.3`, `GPS_Position_Accuracy: -612.1`).

Root causes:

1. **The AiM paths had almost no GPS validation.** The CSV parser only checked
   coordinates plus an ad-hoc 100 m/s implied-speed rule; the XRK mapper only
   checked coordinates. Neither used the logger's own quality channels
   (`GPS Nsat`, `GPS PosAccuracy`, pDOP), applied `MAX_SPEED_MPS`, or emitted
   `parserStats` — so the map's "N rows rejected" badge never appeared.
2. **XRK resampling linearly interpolated quality channels** onto the GPS
   timebase. Interpolating a discrete per-fix reading between a good and a
   corrupt native sample fabricates values no receiver reported (that's where
   "-1597 satellites" came from) and masks garbage behind plausible mid-ramp
   numbers.

## Design

### One central filter, every format

`src/lib/gpsQualityFilter.ts` — `filterGpsQuality(parsed, { hardcore })` —
runs in `datalogParser.ts` right after `normalizeChannels()` in **both** entry
points (`parseDatalogFile`, `parseDatalogContent`). Filtering at this single
point voids bad samples from every feature (race line, laps, distance, speed
stats, charts, g-force, braking zones) for **all** parsers, and quality
channel keys are already canonical there (`satellites`, `hdop`, `h_acc`, plus
a small `custom:` alias list for pDOP variants — pDOP is deliberately *not*
mapped to the HDOP channel; the filter reads both, the registry stays honest).

**Pass 1 — always on.** Drops fixes whose own quality channels condemn them:

- Impossible values (the logger provably wrote garbage): satellites < 0 or
  > 99, negative position accuracy, DOP ≤ 0.
- Weak fixes: satellites < 4 (no 3D fix), position accuracy > 20 m (wider
  than a kart track), DOP > 10 (poor on the standard scale).

Signals are opt-in per sample — files without quality channels pass through
untouched. Position accuracy is unit-converted via the field mapping's unit
(AiM ships mm). **Fallback tier:** if the weak-fix thresholds would reject the
*entire* session (a marginal logger, not a corrupt file), the gate retries
keeping weak fixes and dropping only impossible values — degraded data beats
an unopenable file. Thresholds live in one exported
`DEFAULT_GPS_QUALITY_THRESHOLDS` object so a future override (per-vehicle,
settings) needs no API change.

**Pass 2 — "hardcore data filtering" (opt-in setting, default off).**
Speed-based rules are kart-tuned, and car users exist now — hence opt-in:

- **Teleport gate** (`createTeleportGate` in `parserUtils.ts`): shared
  `isTeleportation()` OR implied speed > 100 m/s within dt < 10 s. The anchor
  advances **only on accepted samples** (a rejected glitch never becomes the
  reference) and re-anchors after 25 consecutive rejections, so one garbage
  fix early in a file can't poison everything after it.
- **Speed repair, not drop**: a sample whose *reported* speed is errant
  (non-finite, negative, > `MAX_SPEED_MPS`) but whose position passed the
  gates keeps its position and gets its speed recomputed from neighboring
  accepted fixes (haversine/dt, O(1) per bad sample). The GPS can compute a
  garbage speed across an errant point — dropping the whole packet would
  discard healthy data. Counted as `ParserStats.repairedSpeeds`.

Rejections are counted in a new `ParserStats.rejected.lowQuality` category
(stats are merged into parser-emitted stats or created fresh), and surfaced by
the existing `RaceLineView` badge ("N rows rejected (… bad-fix …)", "N speeds
repaired").

### Setting + reparse

- `AppSettings.hardcoreGpsFiltering` (default `false`), Switch in
  `SettingsModal` under "GPS Data Filtering".
- The datalog router reads the persisted setting as the default when no
  explicit option is passed (`readHardcoreGpsFilteringSetting()`, a guarded
  localStorage read mirroring `SETTINGS_KEY`), so every parse path respects it
  without per-call-site plumbing; tests/callers can still override explicitly.
- Flipping the toggle with a session open reparses it immediately
  (`Index.tsx` effect → `handleOpenFile`), skipped in read-only viewers whose
  laps are frozen bundles.

### Parser-side changes

- `aimParser.ts`: ad-hoc teleport filter **removed** (migrated to the central
  hardcore pass); exports `H Accuracy` (PosAccuracy converted to meters via
  the RS3 units row), `GPS pDOP` / `HDOP` (only a real hdop column may claim
  the canonical HDOP channel), alongside the existing `Satellites`.
- `xrk/xrkResample.ts`: quality channels are **always forward-filled**, never
  interpolated, whatever the wasm `interpolate` flag says.

## Files

- `src/lib/gpsQualityFilter.ts` (+ `.test.ts`) — the filter
- `src/lib/parserUtils.ts` — `isLowQualityFix`, `createTeleportGate`,
  `accuracyUnitToMeters`, `RejectedCounts.lowQuality`
- `src/lib/datalogParser.ts` — wiring + `DatalogParseOptions`
- `src/lib/aimParser.ts`, `src/lib/xrk/xrkResample.ts` — parser-side changes
- `src/types/racing.ts` — `ParserStats` additions
- `src/hooks/useSettings.ts`, `src/components/SettingsModal.tsx`,
  `src/pages/Index.tsx` — setting + reparse
- `src/components/RaceLineView.tsx`, `src/locales/*` — badge + i18n

## Outcome

A poor-signal Solo2 session now loads with its provably-invalid and weak fixes
removed (badge reports the counts); with hardcore filtering on, teleport
spikes are dropped and errant speeds repaired, restoring sane race lines,
distances, and speed stats from whatever healthy fixes the session contains.
Healthy files are untouched — guarded by real-fixture regression tests
(RaceStudio 3 CSV, `test.xrk`).
