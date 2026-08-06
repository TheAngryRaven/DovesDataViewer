# Device Track Sync — renaming walked courses, and prompting on connect

> Status: **IN PROGRESS**. Three stacked PRs: foundations (this repo's sync
> model + four bugs), the rename wizard, and the on-connect prompts. No firmware
> changes — see *No capability gate is needed* below.

## Why this exists

The on-device course creator (`DovesDataLogger/docs/plans/0002-sprint-mode.md`
§5) shipped: you walk a course on the logger and it writes
`/TRACKS[/SPRINT]/N260803_1432.json`. The name is a GPS date stamp because the
device has **no text entry, ever** — that is a permanent design constraint, not
a gap. So the rename has to happen here.

And it has to be written *back* to the device. Otherwise the app renames its own
copy, the card still holds `N260803_1432.json`, the two no longer match, and the
"please name this" flow fires again on every single connect. That failure mode —
**a track that can never reach `synced`** — turned out to be the thing worth
designing around, because the sync path already had four separate ways to land
in it.

## The four bugs found on the way in

All pre-existing; all produce the same symptom.

1. **`buildTrackJsonForUpload` emitted a bare JSON array.** The firmware parses
   an array, but its array branch (`BirdsEye/sd_functions.ino:475-484`)
   explicitly blanks `longName` / `shortName` / `defaultCourse`, and every
   course falls back to `lengthFt = 0` (`:507`). `lengthFt` is what
   CourseDetector ranks courses by — so a track uploaded from this app could
   never be course-detected and dropped straight to Lap Anything, and the blank
   `shortName` reached the DOVEX header's `short_name` column. The two
   course-level writers in `DeviceTracksTab.tsx` hand-rolled the same array.
2. **`parseDeviceCourseJson` discarded `longName` / `shortName`.** It read the
   object form but returned only `.courses`.
3. **`handleDownloadToApp` never passed a `shortName`** to `addTrack`, and
   `buildMergedTrackList` skips app tracks that have none (`if (!sn) continue`).
   Every downloaded device track was therefore invisible to the merge forever.
4. **Identity was being confused with location.** A device-authored file lives
   at `N260803_1432.json` but declares `shortName: "08031432"` — 8 characters,
   chosen by the firmware author precisely because that is this app's
   `Track.shortName` budget and the key its merge uses
   (`BirdsEye/course_creator.h:36-57`). The merge keyed on the *filename*, so an
   imported track could never match the file it came from.

## Decisions

Confirmed with the owner before building:

| Question | Answer |
|---|---|
| PR split | Three, stacked: foundations → wizard → on-connect prompts |
| What blocks "Save & import" | **Track names always required**, circuit *and* sprint — a venue is permanent. **Course names required for circuit only**: a sprint venue re-lays its course every event, so the date it was walked genuinely is the most useful label |
| Which app tracks are offered as uploads | `isUserDefined` only. The two tracks this app ships are reference data, not "unknown tracks the device is missing" |
| The existing Device → Tracks tab | Untouched. The wizard is connect-only |

And from the brief: **no truncation logic**, on either side — deferred
deliberately; **no firmware capability layer** — "not doing that yet, just
consider it"; **no new BLE opcodes** — a rename is `put(new)` + `delete(old)`,
accepted as the cost of the file needing a rebuild anyway.

### No capability gate is needed

The firmware has parsed the object track form since well before any shipped
release (field units are on 3.0.1 / 3.1.0), and reads `longName`, `shortName`,
`defaultCourse`, `type` and per-course `lengthFt` (`sd_functions.ino:449-507`).
`type: "sprint"` sets `isSprint`; the *folder* stays authoritative. So switching
the writer to the object form asks nothing new of any device in the field.

If a gate is ever wanted, the seam already exists and is already the right
shape: the boolean `DeviceDetails.supportsSprintTracks`.

## Model (PR A — landed)

Pure modules, because the test environment is `node` with no testing-library —
a dialog cannot be rendered, so anything worth asserting lives outside it.
Coverage also excludes `src/components/**/*.tsx` by design.

| Module | Owns |
|---|---|
| `src/lib/deviceTrackSync.ts` | The object-form writer/parser, and the **identity vs location** split: `DeviceTrackFile.shortName` is the declared short name (filename base only as a legacy fallback), `fileName` / `MergedTrackEntry.deviceFileName` is where it lives. `deviceTrackFileFrom()` owns that rule |
| `src/lib/deviceGeneratedNames.ts` | Recognising `N{YYMMDD}_{HHMM}` and `MMDDHHMM`, with the date/time parts validated so a real name that looks the part isn't treated as a placeholder |
| `src/lib/deviceSyncPlan.ts` | What gets offered, in which direction, and what is refused |
| `src/lib/deviceSyncNames.ts` | The name-edit rules and the save gate |
| `src/lib/deviceSyncOps.ts` | The ordered operation list |

### Rows that can never converge are refused, not retried

`buildSyncPlan` drops them with a `SkipReason` rather than offering work that
would fail or re-appear forever:

- **`mixed_kind`** — circuit and sprint courses in one track. Two files in two
  folders on the device; not representable.
- **`too_many_courses`** — past the firmware's `MAX_LAYOUTS` (10), whose parser
  silently ignores the tail, so the file can never read back as written. We do
  **not** trim to fit: dropping a user's courses to turn a checkmark green is
  the worse failure, and truncation is explicitly deferred.
- **`sprint_unsupported`** — a sprint track on the native IPC, which currently
  drops the `kind` argument on get/put/delete and would land the write among the
  circuit tracks (tracked as Android IPC parity, plan 0015).

### Operation ordering is the load-bearing part

Per track: **write the new file → delete the old → update local storage.**

- *Put before delete*, so a failure between them leaves the track on the card
  twice (annoying; the next sync reconciles it) rather than nowhere.
  Delete-first loses a field recording to a dropped BLE packet.
- *Device before app*, so a failure after the write leaves the device holding a
  correctly-named file and the app holding nothing — the next connect offers a
  plain download with no rename needed. The reverse strands a renamed app track
  beside its old device file and the user sees the same track twice.
- FAT is case-insensitive, so a case-only filename change is **not** a rename;
  treating it as one would delete the file just written.

### The test that matters

`deviceSyncOps.test.ts` → *"leaves the device and the app agreeing, so nothing
is re-offered"* replays a plan back through `deviceTrackFileFrom` and
`buildMergedTrackList` and asserts `synced`. Verified to bite: dropping
`shortName` from the stored track makes it report `device_only` — literally the
nag state. An earlier draft of the sibling test in `deviceTrackSync.test.ts`
derived its input from the value under test and passed either way; it now spells
the expectation out.

The same discipline caught the original bug surviving review: a test named
*"emits a JSON array of courses (not a wrapping object)"* had pinned the lossy
shape as the contract.

## The wizard (PR B — landed)

| Module | Owns |
|---|---|
| `src/lib/deviceSyncWizard.ts` | Two-screen state, selection, and the save gate |
| `src/lib/deviceSyncRunner.ts` | Walking the operation list, with injected executors |
| `src/lib/deviceSyncFetch.ts` | Reading both device folders; `buildDeviceSyncSnapshot` |
| `src/components/drawer/DeviceSyncWizard.tsx` | One `useState` and the markup |

Three behaviours worth knowing before changing anything here:

- **Unchecking a row stops it being validated.** Otherwise one track you don't
  want to name blocks the whole sync with no way past it.
- **A course name follows its track's name until the user types in it**, and
  going Back to rename the track re-points every course still following. A name
  they typed is never overwritten.
- **`canSave` re-checks the track screen**, not just the course screen — going
  forward, then back, then clearing a track name must not leave Save live.

`runSyncOperations` keeps going after a failure, but a failed track **abandons
its own remaining operations**: once the new file didn't write, deleting the old
one destroys the only copy. Other tracks still run, which the contiguous
per-track ordering from `planOperations` makes safe.

`trackStorage.saveSyncedTrack` was added because `addTrack`/`addCourse` only
ever *add* — they backfill a short name only when absent and never remove a
course. A partial write leaves the two sides disagreeing, which is the loop this
is all trying to end.

## Still to come

- **PR C — the on-connect prompts.** Firmware check first, with a "remind me
  tomorrow" suppressing for 24 h; then a yes/no track sync, only when the plan
  has actionable rows. `checkForUpdates` needs a `silent` option — today every
  non-update outcome toasts unconditionally, which is wrong for an auto-check.
  Suppression goes in a standalone `src/lib/` module in the
  `pendingCheckout.ts` shape, **not** `AppSettings`, which is cloud-synced.

## Deliberately not done

- No truncation of courses, on either side — owner's call, pending.
- No firmware capability/mapping layer, and no firmware changes at all.
- The native transport's dropped `kind` argument is guarded around, not fixed.
