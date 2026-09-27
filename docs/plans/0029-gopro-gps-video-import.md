# 0029 — Import GPS-tagged GoPro video as a session

## Goal / problem

Many drivers already run a GoPro on the kart or car and nothing else. Every
GoPro since the HERO5 embeds a GPS fix stream (plus IMU) straight into the MP4,
so the video *is* a datalog — just one nobody could open in LapWing. The ask was
deliberately lazy: drop a GoPro `.MP4` on the landing page and get a session
with laps, **and** the footage synced to it for free, with zero extra hardware
or desktop tools.

## Research — how GoPro embeds GPS (GPMF)

Source: GoPro's open-spec [`gpmf-parser`](https://github.com/gopro/gpmf-parser)
README (Apache-2.0; we re-implemented the tiny subset we need rather than vendoring
the C library).

- **Container.** A GoPro MP4 has a fourth track next to video/audio/timecode:
  handler type `meta`, handler name `GoPro MET`, sample-description format
  **`gpmd`**. Its sample table (`stts`/`stsz`/`stsc`/`stco`|`co64`) points at
  ~1 Hz telemetry *payloads* interleaved in `mdat`. Each payload's presentation
  time comes from the MP4 itself — GoPro's guidance is to use the container
  timing, not anything inside the payload. `moov` sits **after** `mdat` on
  camera-written files, so the reader walks top-level boxes with tiny ranged
  reads instead of loading the (multi-GB) file.
- **GPMF** ("GoPro Metadata Format") is big-endian, 32-bit-aligned KLV:
  4-char key, 1-byte type char, 1-byte struct size, 2-byte repeat count, then
  `size × repeat` bytes padded to 4. Type `0` nests. A payload is
  `DEVC` → `STRM`s, each stream holding its channel + modifiers (`SCAL` scale
  divisors, `SIUN` units, `TSMP` running sample count, `STMP` µs stamp, …).
- **GPS5** (HERO5 → HERO10, 18 Hz): type `l`, 5 × int32 per sample —
  lat, lon, alt, 2D speed, 3D speed — scaled by `SCAL` (1e7, 1e7, 1000, 1000, 100).
  Per-payload modifiers: `GPSU` (16-char UTC `yymmddhhmmss.sss`, first sample of
  the payload), `GPSF` (fix: 0 none / 2 / 3), `GPSP` (DOP × 100, "under 500 is
  good"). Samples within a payload are evenly spaced across the payload's MP4
  duration.
- **GPS9** (HERO11 → HERO13, 10 Hz): complex type `?` with `TYPE` = `lllllllSS`
  — lat, lon, alt, 2D speed, 3D speed, days since 2000, seconds since midnight,
  DOP, fix — so **every** sample carries its own UTC time, DOP and fix.
  HERO11 writes both streams; GPS9 is preferred (per-sample quality gating).
  HERO12 has no GPS at all.
- **IMU** (`ACCL`/`GYRO`, ~200 Hz, `GRAV`/`CORI` orientation on HERO8+) is
  camera-frame, so lateral/longitudinal g needs the orientation streams to be
  meaningful. Deliberately **not** imported in v1: the simple chart's default
  "hardware" g source would show helmet-frame accelerations and mislead.
  GPS-derived g is computed as for every other GPS-only format.

## Approach & key decisions

1. **Extract, don't store the video.** The session file we save is the
   extracted telemetry serialised as a **Dove CSV** (`GH010042.dove`), not the
   MP4. It's a few hundred KB, it rides cloud-sync/share/leaderboards untouched,
   and reopening it goes through the ordinary `.dove` parser — no second code
   path to keep alive. Rejected: a custom GPMF container (new parser, no cloud
   value), storing the MP4 (IndexedDB can't sensibly hold a 4 GB blob, and the
   file-import auto-save would have tried).
2. **Container timing is the session clock.** Sample time = payload start (from
   `stts`) + evenly-spaced within the payload; GPS9's per-sample UTC just
   provides the absolute date. Because the telemetry and the video share one
   timeline, the video sync is *known*: `syncOffsetMs = −(media time of the
   first accepted fix)`. The import hands the picked video file(s) to
   `useVideoSync` via a one-shot module handoff (same pattern as
   `leaderboardHandoff`) which loads them as a playlist, applies that offset,
   locks the sync and persists it. No manual sync step.
3. **Chapters.** A GoPro recording is split into ~4 GB chapters
   (`GH01xxxx`, `GH02xxxx`, …), each with its own `gpmd` track. Selecting all of
   them imports one session: each chapter's samples are offset by the cumulative
   `mvhd` duration of the chapters before it (matching the playlist model in
   `lib/videoPlaylist`). Ordering/grouping reuses `groupVideoRecordings`; a
   selection spanning several recordings imports the first and says so.
4. **Quality gating.** Fix < 2 (no lock) samples are dropped at extraction
   (`GPSF` per payload, GPS9 per sample); DOP is written to `hdop` so the shared
   `gpsQualityFilter` applies its DOP > 10 rule like every other format. No
   satellite count exists in GPMF, so none is fabricated.
5. **Parser registration.** `isGoProVideoFile` (extension + `ftyp` probe) is
   checked in `parseDatalogFile` *before* the router's `file.arrayBuffer()` so a
   raw MP4 never gets read whole; the sync `parseDatalogContent` throws for it
   (like XRK). FileImport uses the richer `importGoProVideo` so it can also save
   the CSV and stage the video.

## Touch points

- `src/lib/gopro/mp4Boxes.ts` — pure ISO-BMFF reader over a `ByteSource`
  (ranged reads); finds the `gpmd` track, resolves its sample table.
- `src/lib/gopro/gpmf.ts` — pure KLV decoder + GPS5/GPS9 stream extraction.
- `src/lib/gopro/goproTelemetry.ts` — pure: payloads + timing → GPS rows →
  Dove CSV text, plus the sync offset.
- `src/lib/gopro/goproImport.ts` — File glue (`isGoProVideoFile`,
  `extractGoProTelemetry`, `importGoProVideo`).
- `src/lib/gopro/videoHandoff.ts` — one-shot pending video for a session.
- `src/components/FileImport.tsx`, `src/lib/datalogParser.ts`,
  `src/hooks/useVideoSync.ts` — wiring.

## Status

- [x] Research + plan
- [x] Pure modules + Vitest (synthetic MP4/GPMF fixtures)
- [x] Import UI + auto-attached, pre-synced video
- [ ] Follow-ups: IMU import once `GRAV`/`CORI` orientation handling exists;
  `.360` (MAX/Fusion) files use the same track and should just work but are
  untested.
