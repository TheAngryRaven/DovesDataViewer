# Device course curation — fitting a season of courses on the card

> Status: **IN PROGRESS.** Stacked PRs: (1) the two size/correctness fixes below,
> (2) the pure curation model, (3) the capability gate + sync wiring, (4) the
> picker modal and the tracks list. Firmware side is
> `DovesDataLogger/docs/plans/0005-*`.

## Why this exists

A sprint venue re-lays its cones every event, so the on-device course creator
(`DovesDataLogger/docs/plans/0002-sprint-mode.md` §5) mints a new dated course
each weekend and they all accumulate in one track file. That file has to fit the
logger's track JSON buffer, and **the failure past it is total, not partial**:
the read is cut mid-JSON, `deserializeJson` fails, `buildTrackList()` adds no
manifest entry, and the track stops being detected at the venue at all.

Plan 0002 §7 Q3 already pre-decided the shape of the answer — *"webapp prunes on
sync, keeping the device's most recent single day of courses"* — and v1 shipped
without it, with a disclaimer. This is that work, tightened to **the newest
course**, not the newest day.

Three things have to be true at the end:

1. **Nothing is lost.** Courses the device can't hold still live in the app and
   still ride cloud sync (`TRACKS_SYNC_STORE` is already in `DOC_STORES`). Only
   the *device* holds a subset.
2. **The sync flow never nags.** A curated device set must be able to reach
   `synced` — the exact failure mode plan 0016 was written to end.
3. **The device can save a course when it's full**, without a laptop, in a
   field, on a battery, at an event. That half is the firmware plan.

## The budget

`JSON_BUFFER_SIZE` is **4096** on released firmware and **8192** on the next
release. The firmware's own measurements, per course, in the shape its writer
emits:

| Course shape | Bytes | Fits in 4 KB |
|---|---|---|
| circuit, start line only | 148 | ~26 |
| circuit + 2 sector lines | 384 | ~10 |
| sprint, finish + 2 splits | 528 | **~7** |

That last row was the live bug: `MAX_LAYOUTS` is 10, but a sprint track hit the
4 KB budget at eight courses.

Two consequences. **Both guards stay** — at 8 KB the 10-course cap binds first,
at 4 KB the bytes bind first, and neither subsumes the other. And **the
projection must measure, not estimate**: it calls the real
`serializeDeviceTrackFile` and the real `TextEncoder`, so the number shown to
the user is the number written. The table above is a test sanity-check only.

## Two fixes that come first, because they *cause* the overflow

**Uploads carried their own indentation.** `serializeDeviceTrackFile` emitted
`JSON.stringify(file, null, '\t')`. Tabs and newlines were roughly a quarter of
every file, spent on whitespace nothing reads — the device parses with
ArduinoJson, which is whitespace-insensitive. Dropping it is ~25% more courses
per track for free, and it is the one choke point all three upload writers
funnel through, so it is also what the projection measures.

**Resync All orphaned the file it meant to replace.** `deviceFileOf()` exists so
a write lands on the file the device actually has — for a course the device
wrote, the identity (`08031432`) and the filename (`N260803_1432.json`) are
different strings. Five call sites use it; `handleResyncAll` rebuilt
`shortName + ".json"` for both its delete and its put. So on every
device-created track it deleted nothing and wrote a *second* file, leaving the
original behind — one more file per resync, growing the very budget this plan
is about.

Neither is reachable by test: both live in a component, and the suite runs in
`node` with no DOM renderer. That is also why everything below is a pure module.

## The model (pure, in `src/lib`, unit-tested)

- **`deviceCourseSelection`** — the single resolver every consumer calls, so no
  caller re-implements the rule. Default: circuit keeps every course, sprint
  keeps **only the newest by `dateCreated`**. Then a per-course tri-state
  override applies (explicit include re-adds an older sprint course, explicit
  exclude drops one). **Absent an override the default stands** — which is what
  makes an empty override store a working configuration rather than a broken
  one.
- **`deviceTrackBudget`** — `projectDeviceTrackBytes` and the budget constants,
  selected by one boolean capability.
- **`deviceCourseOverrides`** — the override store. Device-local, per logger,
  modelled on `firmwareUpdateReminder`: private key, pure `parse(raw, now)`,
  bounded and self-pruning. **Deliberately not in `DOC_STORES`** — it describes
  one physical card, not the user's garage, so it must not follow them to
  another browser. Every failure mode (unknown logger, expired, corrupt) lands
  on "absent", and absent means the default rule.

## The capability boolean

`supportsLargeTrackBuffer`, set on `DeviceDetails` in `bleDetails.ts` beside
`supportsSprintTracks`, mirroring the existing `needsOtaLayoutUpgrade` pattern
(`ble/dfu/firmwareUpdateError.ts`) over the pure `compareVersions`. One
comparison, at the edge; nothing downstream sees a version.

**Unknown version assumes the small budget** — the opposite of
`needsOtaLayoutUpgrade`, deliberately. That one must never nag without
certainty; this one must never overfill a card, because guessing high takes the
track out of detection at the venue.

`compareVersions` ignores prerelease suffixes, so a beta build stamped
`3.0.1-beta.<sha>` compares as `3.0.1`. The firmware's version literal has to
move past the last release for this to read correctly on beta units.

## Where a curated subset breaks today

| Site | Effect |
|---|---|
| `deviceTrackSync.ts` `allSynced` | Every app course must be on the device or the track reads `mismatch` forever → **prompt on every connect, permanently** |
| `deviceSyncPlan.ts` count guard | An 11-course venue is skipped entirely and can never sync |
| `deviceSyncOps.ts` / `rebuildDeviceTrackJson` | Accepting the wizard re-uploads every course, **silently destroying the curation** |

The first is the one that matters: it is the same never-reaches-`synced` trap
plan 0016 closed, reopened by curation.

**A track that still won't fit is reported as a skip with a reason**, surfaced
in the list the way `too_many_courses` already is — never as an auto-prompt.
The picker is reachable only from a deliberate user action. That is what keeps
an empty override store from resuming the nag.
