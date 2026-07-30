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
