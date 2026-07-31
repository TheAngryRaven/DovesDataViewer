# 0014 — GPS quality cleanup: drop provably-bad rows on load (all formats)

## Problem

An AiM Solo2 user imported an `.xrk` session recorded with 95–99% GPS packet
loss. Errant fixes survived parsing and corrupted every downstream feature:
race-line spikes miles off track, a 134.49 mi session distance, a 735 mph max
speed, and impossible chart-tooltip values (`Satellites: -1597.4`,
`GPS_pDOP: 275.3`, `GPS_Position_Accuracy: -612.1`).

Root causes:

1. **Nothing looked at the loggers' own quality channels.** Formats that
   record fix quality (`GPS Nsat`, `GPS PosAccuracy`, pDOP/HDOP) carried the
   proof that a row was garbage — negative satellite counts, negative
   accuracy — and no parser or shared layer acted on it.
2. **XRK resampling linearly interpolated quality channels** onto the GPS
   timebase. Interpolating a discrete per-fix reading between a good and a
   corrupt native sample fabricates values no receiver reported (that's where
   "-1597 satellites" came from) and smears the garbage so the bad rows can't
   be identified cleanly.

## Design — step 1: rebuild the datalog without the bad rows

> Maintainer direction: as each "blip" loads, look for the provably-bad ones
> (suddenly negative numbers, junk DOP) and rebuild the datalog into a clean
> dataset — drop the bad rows, nothing else. No reprocessing yet. Whether the
> survivors need speed reprocessing or further filtering is decided *after*
> the spikes are gone, as a separate step.

`src/lib/gpsQualityFilter.ts` — `filterGpsQuality(parsed)` — runs in
`datalogParser.ts` right after `normalizeChannels()` in **both** entry points
(`parseDatalogFile`, `parseDatalogContent`). One integration point covers
every format at the single place all features draw from, and quality channel
keys are already canonical there.

**Drop rules** — a row is skipped during the rebuild when:

- any quality signal it carries is **negative** (`isLowQualityFix` in
  `parserUtils.ts`) — satellite counts, position accuracy, and DOP can never
  go negative, so the logger provably wrote garbage on that row; or
- its **DOP is above `MAX_DOP` (10)** — a junk fix on the standard scale; or
- its **position implies moving faster than `MAX_SPEED_MPS`** (150 m/s,
  ~335 mph — the app-wide "anything above is a GPS glitch" bound) from the
  last kept row. This exists because a corrupt fix can carry NO quality data
  at all: under heavy packet loss the logger writes a garbage position
  without recording satellites/DOP for that row, so the position itself is
  the only proof. The reference only advances on kept rows, and after 50
  consecutive jump rejections it re-anchors so one garbage row early in the
  file can't condemn the rest.

Quality signals are opt-in per row: absent/non-finite values are skipped, so
files without quality channels still get the jump check but nothing else. If
*every* row would be condemned, the file is shown raw instead of refused.
Drops are counted in `ParserStats.rejected` (`lowQuality` for condemned
quality values — the `bad-fix` badge reason — and `teleportation` for
impossible jumps, which the badge already displayed for other parsers).

**Channel key lists** (the per-signal "secondary lists" — extend when a format
carries a signal under a new name):

- satellites → `satellites` (canonical)
- DOP → `hdop` (canonical) + `custom:gps_pdop` / `gps_posdop` / `gps_hdop` /
  `pdop` (pDOP deliberately stays custom — it is not HDOP and must not be
  mislabeled in the channel registry; the same bound works for either)
- position accuracy → `h_acc` (canonical) + `custom:gps_posaccuracy` /
  `gps_pos_accuracy` / `gps_position_accuracy` (covers MyChron/Solo2 spellings)

### The actual root cause in the reported file: broken timecodes

With the user's `.xrk` in hand, the "bad GPS" theory collapsed: **every native
GPS sample in the file is healthy** — all 48k positions inside a ~1 km box at
the track, 8–16 sats, pDOP ≤ 2.1, accuracy ≤ 0.77 m, speed ≤ 110 mph. What's
corrupt is the **clock**: the wasm decoder mis-unwraps a 16-bit millisecond
counter across interleaved sample blocks, stamping rows with spurious
±k*65536 ms offsets, out-of-order blocks, and duplicated timestamps — a
16-minute race spanning "64 hours". Resampling other channels against that
non-monotonic clock *extrapolated* them (`interpolateOnto`'s unclamped
fraction), fabricating positions miles off track (the map spikes), 735 mph
speeds (native max: 110), and the impossible interpolated quality values.
The "99.4% packets dropped" banner was the same artifact (25 Hz × 64 h).

**Repair** (`xrkResample.ts`, applied per channel ONLY when the fault is
provable — time running backwards, or ≥3 deltas sitting within 1 s of an
exact 65536 multiple; a real pit-stop gap is nowhere near one):
unfold the spurious multiples (tracked against the last true time so
straggler rows resolve), stable-sort rows by true time, skip rows that don't
advance the clock. Values are never altered or invented. `interpolateOnto`
additionally clamps its fraction to [0,1] so it can never extrapolate again.

Verified against the reported file: duration 64 h → 20 min, zero samples off
track, zero inter-sample jumps > 500 m, max speed 110.2 mph (= native max),
monotonic time; the remaining interleave stragglers are culled by the
position-jump rule below.

### The decoder-level fix (libxrk fork)

The TS-side repair above is a mitigation; the true fix landed in the decoder
(`TheAngryRaven/libxrk`, branch `fix/solo2-gps-timecode-corruption`,
rev pinned in `xrk-wasm/Cargo.toml`; wasm rebuilt via
`scripts/build-xrk-wasm.sh`):

- `fix_timecodes` (the "old MXP firmware" unwrap) treated ANY backwards
  logger-timestamp step as a 16-bit rollover (+65536 ms). Newer Solo 2
  firmware writes small out-of-order jitter at block seams, so the unwrap
  fired 3,500+ times → the "64-hour" session. Now phase-unwraps with
  half-range hysteresis: only a masked step > 32768 ms is a rollover.
- New `sanitize_gps_records`: when logger timecodes run backwards, rebuild
  the GPS timeline from the receiver's own clock — the NAV-SOL `itow`
  field, immune to the logger bug. The affected files also write EVERY
  epoch twice (two solutions ~4 m apart sharing one `itow`; each stream is
  centimeter-smooth alone, mixing them is the square-wave staircase), so
  exactly one record is kept per epoch. Handles GPS week rollover; falls
  back to unwrap+sort when `itow` is unusable; clean files untouched
  byte-for-byte.

Verified against the reported file with the rebuilt wasm: 24,309 epochs /
972 s / 18.96 mi (≈ 7 × 2.68 mi laps), lap times matching RaceStudio
(best 127.780 s = RS3's 2:07.800), zero off-track samples, 17 rows dropped
total. With the decoder fixed, the TS-side timecode repair no longer
triggers and remains as a dormant safety net.

### Supporting changes

- `xrk/xrkResample.ts`: quality channels are **never fabricated** — a row
  gets a quality value only when the channel has a native sample at that
  row's timecode (±5 ms); everywhere else it stays NaN/absent. Interpolation
  invented values no receiver reported ("-1597 satellites"), and forward-fill
  (tried first) was worse: it carried a *healthy* reading onto a garbage row,
  which made the corrupt fix look clean and hid it from the cleanup entirely.
- `aimParser.ts`: exports `H Accuracy` (PosAccuracy converted to meters via
  the RS3 units row) and pDOP/HDOP (only a real hdop column may claim the
  canonical HDOP channel), alongside the existing `Satellites` — feeding the
  cleanup and the charts. Its always-on 100 m/s implied-speed teleport filter
  is unchanged.

## Deliberately NOT in step 1 (tried, reverted by maintainer review)

A first cut of this plan shipped weak-fix thresholds (sats < 4, accuracy
> 20 m), a "hardcore data filtering" setting with a teleport gate, and
neighbor-based speed repair. That went beyond "drop the provably-bad rows"
into reprocessing territory and was reverted. If the cleaned datasets still
show problems, later steps (speed reprocessing around dropped rows, opt-in
stronger filtering) get designed on top of the clean data — not bundled here.

## Files

- `src/lib/gpsQualityFilter.ts` (+ `.test.ts`) — the cleanup pass
- `src/lib/parserUtils.ts` — `isLowQualityFix`, `MAX_DOP`,
  `accuracyUnitToMeters`, `RejectedCounts.lowQuality`
- `src/lib/datalogParser.ts` — wiring (both entry points)
- `src/lib/aimParser.ts`, `src/lib/xrk/xrkResample.ts` — parser-side changes
- `src/types/racing.ts` — `ParserStats.rejected.lowQuality`
- `src/components/RaceLineView.tsx`, `src/locales/*` — `bad-fix` badge reason

## Outcome

A poor-signal Solo2 session now loads as a clean dataset with its
provably-garbage rows gone (badge reports the count), instead of a 134-mile
race line and a 735 mph top speed. Healthy files are untouched — guarded by
real-fixture regression tests (RaceStudio 3 CSV, `test.xrk`).
