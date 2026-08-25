# 0021 — Beta firmware blocked the official release; force update

A logger running `4.1.0-beta.<gitsha>` could not be moved to the official
`4.1.0`. The app said it was already up to date, and on lapwingdata.com there
was no way to argue with it.

## The comparator was answering the wrong question

`firmwareManifest.ts` had one comparator, `compareVersions()`, and it compares
the **numeric core only** — `versionCore()` splits on `/[-+]/` and keeps the
first piece. So `compareVersions("4.1.0", "4.1.0-beta.a1b2c3d") === 0`,
`isUpdateAvailable()` returned false, and `evaluateFirmwareUpdate()` reported
`up-to-date`.

That is not a bug in `compareVersions`. It has two other callers and **both
need exactly that behaviour**:

- `supportsLargeTrackBuffer()` (`deviceTrackBudget.ts:45`) — `>= '3.2.0'`.
- `needsOtaLayoutUpgrade()` (`firmwareUpdateError.ts:56`) — `< '3.1.0'`.

Both ask *"does this build carry feature X"*, and a beta cut from a release
carries that release's features. Make `compareVersions` semver-strict and a
`3.2.0-beta` device silently drops to the small track buffer (losing courses at
a venue, per plan 0017) and a `3.1.0-beta` device gets told to install `3.1.0`
first — a hop to the layout it already has.

So the fix is a **second comparator**, not a corrected one. There are genuinely
two questions:

| Question | Comparator | `4.1.0-beta.x` vs `4.1.0` |
|---|---|---|
| Does this firmware have feature X? | `compareVersions` | equal |
| Is the published build newer than what's installed? | `compareReleases` | lower |

`compareReleases()` implements semver 2.0.0 §11 properly: numeric core first
(by literally calling `compareVersions`, so the two can never disagree about
the core), then a prerelease sorting **below** its release, identifier by
identifier — numeric compared numerically, numeric ranking below alphanumeric,
a longer identifier set winning a tie. Build metadata (`+…`) is stripped and
never affects precedence (§10). Only `isUpdateAvailable()` uses it.

Ordering **between two betas** of the same core falls out of comparing git
shas, which is arbitrary rather than chronological — and this is the one place
the change alters behaviour nobody asked it to. Under the old comparator two
betas of the same core compared *equal*, so the beta channel's answer was a
deterministic "nothing new". It is now a lexical sha comparison.

That is harmless **only because preview builds pass `force: isPreviewBuild()`
unconditionally**, which short-circuits the comparison before it is ever
consulted. It is a live trap if anyone ever makes preview builds stop forcing:
beta→beta offers would become non-deterministic. Give a beta a real ordering
key before touching that.

The regression guard is the point of the exercise, so it is pinned from both
sides: `compareVersions` has a test asserting a beta reads as its release *and
saying why*, and each capability gate has its own beta case
(`deviceTrackBudget.test.ts` already had one; `firmwareUpdateError.test.ts`
did not, and does now).

## Force update

The comparator fix handles beta → release. It cannot handle the other
direction, and shouldn't: a device on `4.2.0-beta.x` is genuinely ahead of a
published `4.1.0`, so no comparison will offer the move. Neither will it
re-offer a version already installed, which is what you want after a flash you
don't trust.

`force` already existed in `evaluateFirmwareUpdate()` — but only ever fed from
`isPreviewBuild()`, so it was reachable on beta.lapwingdata.com and nowhere
else. It is now also reachable by asking:

- `checkForUpdates({ force: true })` on the web hook, `begin({ force: true })`
  on the native one.
- A permanent **Force update…** button under *Check for updates*, and an
  **Install anyway** action on the "firmware is up to date" toast. Both,
  deliberately: the toast catches the user at the moment they hit the wall, but
  a device that is *ahead* of the published build never produces that toast, so
  the escape hatch cannot live only there.
- A force **ignores the "remind me tomorrow" snooze** (`checkForUpdates` skips
  `suppress` when `force` is set). Someone who just pressed the button is not
  being reminded tomorrow.

**Testing it needs a production build.** On a preview build
`force || isPreviewBuild()` is always true, so `evaluateFirmwareUpdate` never
returns `up-to-date` and the toast branch is unreachable — the new button looks
identical to *Check for updates*. Verify on production, or pin
`VITE_FIRMWARE_MANIFEST_URL`.

## `forced` didn't say who forced it

The dialog showed one note for every bypass: *"On beta branches updates always
push through for testing."* Three different things reach that state, and on the
native flow two of them were already showing that sentence untruthfully — the
`no-version` and `chooseVariant` paths set `forced` when the real reason was an
unreadable version.

`FirmwareForceKind` (`"preview" | "user" | "unknown" | null`) replaces the
boolean in both hooks' state; `forced` stays as a derived boolean so the
existing confirm-blurb branch is untouched. Each kind gets its own note.

Two of them can be true at once, and `evaluateFirmwareUpdate` resolves `force`
*before* `no-version`, so `reason` alone cannot separate them.
`forceKindFor(reason, userRequested, installedVersion)` — pure, in
`firmwareManifest.ts` beside the enum, host-tested, and shared by both hooks so
they cannot drift — makes the tie-break explicit: **`"unknown"` beats
`"user"`**. It is the more
informative of the two — it explains why the dialog can't name what you are
upgrading *from* — and "you asked for this" is not news to the person who
pressed the button.

While the state was in hand, two pre-existing leaks got closed, both made
easier to reach by a path that populates an offer without an update existing:
`forceKind` is now cleared by `dismiss()` and `finish()`, not just `cancel()`;
and a connection change clears `latestVersion` / `pendingBuild` / `forceKind`
rather than only `info` — `snooze()` keys on `deviceName` + `latestVersion`, so
a device swap could otherwise snooze a pair that never existed.

## Not changed

- `compareVersions` behaviour, and therefore both capability gates.
- The manifest channel split (`getManifestUrl()`): a preview build still checks
  the beta channel, production still checks production. Force decides *whether*
  to offer the build it found, never *which* manifest to read.
- `versionCheck.ts`'s same-named `isUpdateAvailable`. Same name, different
  question: it is the app's own "a newer build is deployed" poll, and it
  compares commit hash plus build timestamp rather than any version string, so
  it never had this flaw. Nothing imports it from here.

## Known limitations, recorded so they aren't rediscovered

- **`parseFirmwareManifest` drops the beta manifest's `channel` / `commit` /
  `branch` / `uf2` fields.** The app therefore cannot tell a beta manifest from
  a production one by content — only by which URL it fetched. If the copy ever
  wants to say "you're on a beta of this release", those fields are already on
  the wire.
- **A forced downgrade is now one press away, and the firmware allows it** —
  the OTA path gates on variant and CRC, with no version floor on the device.
  `forcedUserNote` says so in words. Second-order effect worth knowing: 4.1.0
  renamed `rev_limit` → `target_rpm`, and `deviceSettingsSchema.ts` keys off
  **which key the device reports**, not a version, so the app itself survives
  the round trip while the user may not notice their settings changing shape.
- **`DeviceConnectFlow` shares this hook instance.** Its watcher advances to
  the tracks step when `confirmOpen` falls having been true, so a force fired
  from the drawer during `phase === "firmware"` trips it. Benign today (the
  track prompt only renders when there is work), but it is now a real coupling
  rather than a theoretical one.
- **Only `checkForUpdates`' toasts were localised** (its four, plus the new
  disconnect guard on `startUpdate`), since that is what this change touched.
  `startUpdate`'s success and failure toasts are still hardcoded English — a
  separate concern, deliberately left.
