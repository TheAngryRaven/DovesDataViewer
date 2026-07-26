-- ============================================================================
-- Backfill: Fledgling firmware release posts for the /updates blog (plan 0012)
-- ============================================================================
--
-- One post per shipped DovesDataLogger (BirdsEye) firmware release, v1.0.0
-- (March 2026) through v3.0.1, reconstructed from that repo's CHANGELOG.md and
-- its GitHub release pages. Companion to 0001_backfill_release_posts.sql, which
-- does the same for the web app.
--
-- TAGS
--   Every post carries BOTH 'hardware update' and 'fledgling'. Neither is
--   WEB_UPDATE_TAG ('web update'), so these land in the landing page's second
--   "Latest updates" panel -- the newest non-release-note item -- rather than
--   competing with the web app's release posts for the first one. Both tags
--   also become filter pills on /updates.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL editor and run it. The editor
--   connects as postgres, which bypasses RLS, so the admin-only insert policy
--   on public.posts is not in the way.
--
--   Like 0001, this is deliberately ONE statement using only standard SQL
--   literals -- no dollar-quoting, no temp table, no BEGIN/COMMIT. The SQL
--   editor mis-parses dollar-quoted strings ($tag$...$tag$); see the header of
--   0001 for the details. Apostrophes in the bodies are escaped the standard
--   way, as two single quotes ('' ).
--
-- SAFE TO RE-RUN
--   ON CONFLICT (slug) DO NOTHING, so re-running skips posts that already
--   exist and never overwrites a post you have edited in the admin UI.
--
-- AUTHOR / AI-ASSISTED FLAG / DATES
--   Same conventions as 0001: author_id resolves to the first admin account,
--   ai_assisted is true (these were drafted from the changelog with AI
--   assistance), and published_at is each release's real GitHub publish
--   timestamp so the index reads in true release order.
-- ============================================================================

insert into public.posts (
  slug, title, body, tags, ai_assisted, published, published_at, created_at, updated_at, author_id
)
select
  v.slug,
  v.title,
  v.body,
  array['hardware update', 'fledgling']::text[],
  true,                                   -- ai_assisted
  true,                                   -- published
  v.published_at,
  v.published_at,                         -- created_at
  v.published_at,                         -- updated_at
  (select ur.user_id from public.user_roles ur where ur.role = 'admin' limit 1)
from (values
  --  1. v1.0.0
  ('firmware-v1-0-0-the-official-beta', 'Firmware v1.0.0 — The Official Beta', 'The Fledgling''s firmware — BirdsEye — reached its first tagged release on March 3, 2026, but the core of it had been coming together since 2024. Years, on and off. The release note at the time put it plainly: many years in the making, and it finally feels like a solid beta.

It is a DIY GPS lap timer and datalogger built on a Seeed XIAO nRF52840, and by 1.0.0 it already did the whole job on its own — no phone, no laptop, nothing to connect to at the track.

### What the first release could do

- **25 Hz GPS lap timing** with optional 2- and 3-sector support, via the DovesLapTimer library.
- **"Just Drive" auto track and course detection** through CourseManager, with a Lap Anything waypoint fallback for venues it does not know.
- **DOVEX crash-safe logging** with a reserved 1 KB session header, plus instant on-device replay of a session you just ran.
- **RPM from an inductive tachometer**, Kalman-filtered, and g-force from the onboard LSM6DS3 IMU.
- **Eight-plus OLED pages**, Bluetooth LE file download, settings, and track sync, and a low-power sleep mode.

The honest caveats shipped with it. Automatic course detection was the one real feature still missing at that point. The tachometer was called out as "super beta" — it is the hard circuit on the board, and the recommendation was to isolate it with an optocoupler and an isolated DC-DC supply fed from the XIAO. Temperature sensors were left as an exercise for anyone who wanted them.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v1.0.0)
', '2026-03-03T04:23:32Z'::timestamptz),

  --  2. v2.0.0
  ('firmware-v2-0-0-just-drive-dovex-logging-and-a-real-test-suite', 'Firmware v2.0.0 — Just Drive, DOVEX Logging, and a Real Test Suite', 'v2.0.0 is where the firmware stopped asking you questions. The old manual flow — pick your track, pick your location, pick your direction — is gone entirely, replaced by automatic detection that just works when you start driving. It is also the release where the project grew a proper engineering harness around itself.

### Just Drive

Automatic track and course detection via CourseManager, with DOVEX logging always on. The legacy `ENABLE_NEW_UI` compile path and everything it gated went with it: the manual selection menus, the DovesLapTimer-direct flow, legacy `.dove` and `.nmea` streamed replay, and the `use_legacy_csv` setting. One flow, auto-detected, every time. That is a breaking change, and it is why this is a major version.

### Hardware and sensing

- **Accelerometer support** through the onboard IMU, with a fix for an `analogRead` pin bug and improved tachometer filtering.
- **A BLE track manager and settings system**, so tracks and configuration sync over Bluetooth instead of requiring the SD card come out.
- **EMI hardening** — SPI and UART clocks were reduced deliberately. Ignition noise on a running kart is a real adversary, and the slower clocks buy margin.
- Tweaks to GPS recovery during sleep, plus a batch of fixes that came straight out of an actual track day.

### The engineering harness

This is the less visible half, and arguably the more important one:

- **A host-side unit test harness** (doctest + CMake) covering the pure-logic units — haversine distance, GPS time and epoch math, GPS sample validation, and the DOVEX header format and parser. It runs in CI on every push.
- **`clang-tidy` static analysis** in CI across the bugprone, performance, portability, and clang-analyzer families, with warnings treated as errors.
- **A flash-size budget gate**: the build fails if the firmware uses more than 90% of program flash, which protects headroom for future OTA updates.
- **A release pipeline** — CHANGELOG plus tag-triggered `.uf2` and `.hex` artifacts — and a `compile-sketch` CI job so the sketch is always known to build.
- The monolithic sketch was **refactored into modules** with per-module headers documenting each subsystem''s interface, and moved into a `BirdsEye/` folder to satisfy the Arduino toolchain.

### Security

Every BLE command carrying a filename (`GET`, `DELETE`, `TGET`, `TPUT`, `TDEL`) is now validated for path traversal (`..`, leading dots), path separators, and FAT-unsafe characters **before** any SD access. Rejected cleanly with `ERROR` / `NOT_FOUND` or `TERR:BAD_NAME`. The device is a Bluetooth peripheral that anyone in radio range can talk to; unvalidated filenames were not acceptable.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v2.0.0)
', '2026-05-22T00:41:22Z'::timestamptz),

  --  3. v2.1.0
  ('firmware-v2-1-0-over-the-air-updates-and-two-board-variants', 'Firmware v2.1.0 — Over-the-Air Updates and Two Board Variants', 'Updating a sealed logger used to mean opening it up. v2.1.0 is the first step toward never doing that again: the firmware now advertises itself over Bluetooth well enough for a companion app to see what is installed, decide whether it is stale, and push a new image.

### OTA groundwork

- **Buttonless Secure DFU.** The firmware registers the `BLEDfu` service, so a companion — DovesDataViewer over Web Bluetooth — can reboot the board into the bootloader''s Nordic Secure DFU mode and flash it without a physical reset double-tap. The bootloader validates the signed and CRC''d package before writing, so a corrupt or mismatched image is rejected rather than bricking the board.
- **Version reporting over BLE** through the standard Device Information Service (`BLEDis`, Firmware Revision `0x2A26`). The companion can read the installed version and compare it against the latest release.
- **Two board variants, built and published separately.** Release builds now cover both the XIAO nRF52840 **Sense** (onboard IMU, so g-force logging) and the plain **non-Sense** board, published as `BirdsEye-sense.*` and `BirdsEye-nonsense.*`. The DIS model string encodes which one you have, so the companion fetches the matching image.
- **An OTA manifest on GitHub Pages.** On a version tag, CI pushes the DFU packages plus a stable `manifest.json` — latest version and per-variant download URLs, keyed by the DIS model string — to `gh-pages`. Pages serves with permissive CORS, unlike raw release-asset URLs, which is exactly why the manifest lives there. Older versions stay under `firmware/<version>/` for rollback.

### Never fault out of a race

Two related changes that matter if you have ever had a session die on you:

- **Logging is gated on a real GPS time lock.** File creation previously only checked `day > 0`, so before the module resolved UTC it would create a log named from a placeholder date. That name was identical on every boot, and once a write was interrupted the half-written file could not be reopened — producing an "Error saving log" fault that reproduced on every single reboot afterward. Creation now requires `validDate + validTime + fullyResolved`, and a fix now also requires `gnssFixOK`.
- **Logging failures no longer drop you out of race mode.** With the engine turning but no lock yet, the device pins you to the tachometer and waits, then starts logging and resumes normal navigation the moment a valid lock arrives. A failed log-file open is retried at 1 Hz instead of faulting, and a mid-session write failure stops logging while the race continues. None of these show the full-screen "Please Reboot Device" fault anymore.

Also in this release: self-hosted code coverage in CI, with a gate, a live badge, and a per-PR summary comment — no third-party coverage service.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v2.1.0)
', '2026-06-06T06:08:40Z'::timestamptz),

  --  4. v2.2.0
  ('firmware-v2-2-0-sd-staged-ota-over-bluetooth', 'Firmware v2.2.0 — SD-Staged OTA Over Bluetooth', 'There is a problem with updating a sealed unit over the web: Chrome''s Web Bluetooth blocklist bans the Nordic legacy DFU service, and our sealed units have no pins to install a web-allowed Secure DFU bootloader on. So the firmware learned to update *itself*.

### How it works

The DovesDataViewer web app streams the new image to the SD card over the existing `0x1820` file service. The firmware CRC-32 verifies it, copies it into a free internal-flash region, and then a **RAM-resident flasher** swaps it into the application region and resets. The whole thing rides a new `FW*` command protocol:

`FWBEGIN:<size>,<crc>` → `FWCRC:<crc>` handshake, then `FWPUT:<size>` → `FWREADY` plus raw chunks → `FWDONE` → `FWOK:<crc>` or `FWERR:<reason>`, then `FWAPPLY` → `FWSTAGE:<pct>` → `FWAPPLIED`.

The CRC is CRC-32/IEEE-802.3 (zlib), lowercase 8-character hex, pinned to the web client''s algorithm by a new host-tested `crc32` unit — both sides agree on one value or nothing happens.

### The guardrails

Flashing yourself is exactly as dangerous as it sounds, so the apply path is fenced in on four sides:

- A **battery-voltage check** (`FWERR:BATTERY`) — you do not want the lights going out mid-swap.
- An **embedded variant and magic check** (`FWERR:VARIANT`), so a Sense image cannot land on a non-Sense board.
- An **in-flash CRC re-verify** before the application region is ever erased.
- A **GPREGRET bootloader-recovery flag**, so an interrupted swap leaves the unit re-flashable over Bluetooth rather than bricked.

The OTA manifest now also publishes the raw app image and its CRC-32 (`appBin`, `appCrc32`, `appSize`) alongside the DFU `.zip`. The web client downloads the binary directly with no client-side unzip, sends the size and CRC it read from the manifest, and the device''s `FWOK` must match. Build pipeline, web app, and firmware all agree on one checksum.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v2.2.0)
', '2026-06-08T04:01:12Z'::timestamptz),

  --  5. v2.2.1
  ('firmware-v2-2-1-variant-declared-in-the-ota-handshake', 'Firmware v2.2.1 — Variant Declared in the OTA Handshake', 'A quick correction to the OTA protocol shipped hours earlier in v2.2.0: the firmware was inferring the target board variant by scanning the image bytes at apply time, and it was getting it wrong — misfiring `FWERR:VARIANT` on perfectly correct sense-to-sense flashes.

The variant is now **declared up front in the handshake** instead of guessed at the end. `FWBEGIN` gains a third field — `FWBEGIN:<size>,<crc32>,<variant>` — where the variant (`sense` or `nonsense`) is derived authoritatively by the web app from the device''s own DIS Model Number. The firmware compares it case-insensitively against its compile-time `FIRMWARE_VARIANT` and replies `FWERR:VARIANT` **before any upload happens** on a mismatch. Failing in the handshake instead of after a full image transfer is strictly better.

The old image-byte scan at `FWAPPLY` is gone. The embedded image descriptor is kept, but for forensics only.

**Breaking:** a web client still sending the two-field `FWBEGIN:<size>,<crc32>` is rejected. The web side updated in lockstep.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v2.2.1)
', '2026-06-08T22:35:27Z'::timestamptz),

  --  6. v2.2.2
  ('firmware-v2-2-2-board-variant-follows-the-ide-selection', 'Firmware v2.2.2 — Board Variant Follows the IDE Selection', 'One more variant fix, and this one only bit people building from the Arduino IDE rather than CI.

`FIRMWARE_VARIANT` was only ever set by the CI and release build flags (`-DBIRDSEYE_BOARD_SENSE` / `-DBIRDSEYE_BOARD_NONSENSE`). A plain IDE build with neither flag always reported `"sense"` regardless of which board you had actually selected. So a non-Sense unit flashed from the IDE mislabeled itself in its BLE Device Information Service model number — and therefore lied to the OTA update check, which keys the image it fetches off exactly that string.

`project.h` now derives the variant from the Seeeduino core''s `ARDUINO_Seeed_XIAO_nRF52840[_Sense]` board macro when no explicit build flag is present. The explicit CI flags still take precedence, and an unknown board still falls back to `"sense"`.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v2.2.2)
', '2026-06-08T22:49:34Z'::timestamptz),

  --  7. v2.2.3
  ('firmware-v2-2-3-making-ota-actually-stick', 'Firmware v2.2.3 — Making OTA Actually Stick', 'v2.2.0 shipped self-flashing OTA. v2.2.3 is the release where it actually worked. Three separate bugs meant an update could report success, reboot, and leave you on the old firmware — each with a different root cause, and each only visible once real devices were being updated in the field.

### The three failures

- **The apply was aborted by the very disconnect that triggered it.** After `FWAPPLY`, the web app disconnects to hand the device off to self-flash. But the Bluetooth loop ran its disconnect teardown — which calls `fwReset()` to abort the OTA, then reboots — *before* the OTA loop where the apply actually runs. So the disconnect discarded the staged image and rebooted into the old firmware, reported as "applied OK, rebooted, still the old version". The teardown now detects an in-flight apply and skips both the abort and the reboot.
- **The self-flash swap silently no-opped.** The apply disabled the SoftDevice with the web app still connected, and ignored the return code. The SoftDevice will not cleanly disable while a link is up, so it stayed partly active, flash remained SoftDevice-protected, and the RAM flasher''s raw NVMC erase and copy did nothing at all — but the final reset still fired, rebooting into the intact old image. The apply now disconnects the central, waits for the link to close, disables the SoftDevice, and **checks the return value**.
- **The device parked in the bootloader instead of booting the new app.** The apply arms a bootloader-recovery magic value (`GPREGRET = 0xA8`) before the destructive swap, but never cleared it on success — so after the reset the bootloader saw the magic and sat in BLE DFU mode instead of booting the freshly installed firmware. Blank screen, odd USB device on the PC, and a manual power-cycle "fixed" it, which is precisely why it was confusing. The RAM flasher now clears the register after a successful copy. An interrupted swap never reaches that line, so the recovery net is untouched.

### Visibility while it happens

The OLED now shows a full-screen **"UPDATING FIRMWARE / Do not power off"** notice during an apply. The apply blocks the main loop and ends in a reboot; previously the screen just sat on a stale page with no sign anything was happening. The apply also emits `FWDBG:*` breadcrumbs (`APPLY`, `VBAT=<mv>`, `STAGE`, `ERASE=<pages>`, `ERASED`) over the status characteristic, so a stall can be pinpointed from the web app''s raw notification log — the up-front staging erase takes several seconds with no progress notifications, so it is bracketed explicitly.

### A beta channel

A new CI workflow builds both variants on every push to `BETA` and publishes them to a `beta/` subtree on GitHub Pages — a second OTA channel alongside production. No release, no tag; these are throwaway debug builds you flash from your phone at the track. A beta build also self-reports its exact commit as `<base>-beta.<gitsha>`, so reading the version off a device tells you precisely which nightly is on it. Retention is latest-only.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v2.2.3)
', '2026-06-10T01:36:03Z'::timestamptz),

  --  8. v3.0.0
  ('firmware-v3-0-0-insta360-auto-record-usb-transfer-and-a-real-power-switch', 'Firmware v3.0.0 — Insta360 Auto-Record, USB Transfer, and a Real Power Switch', 'v3.0.0 rolls up an entire beta cycle and is the biggest firmware release so far. Your camera now starts and stops itself, the SD card mounts as a normal USB drive, the device genuinely powers off instead of pretending to, and the whole firmware can now run in a browser.

### The camera records itself

The device emulates the physical Insta360 GPS Remote as a Bluetooth peripheral, which is enough to drive an X4 completely hands-free. Start the engine and a paired, powered-off camera is woken with the remote''s manufacturer-data advertisement carrying the camera''s serial — byte-for-byte the genuine remote''s payload, captured with nRF Connect and confirmed against a real X4. The camera connects back to us, and all control rides the `ce82` notification channel exactly like the real remote.

The lifecycle is deliberately simple and RPM-driven: engine start wakes and connects the camera, about five seconds of sustained RPM starts recording, and 30 seconds of engine-off stops recording and ends the log session. The camera then enters a **watching** state — still on, still connected — so a brief on-track stall recovers straight back into recording.

The subtle part is record state. The shutter is a stateful toggle, so a lost frame used to *invert* our belief and stop a live recording. A Wireshark capture of the genuine remote link showed the camera reports its state implicitly through its display-string frame: a running `.HH:MM:SS` timer while recording, the mode string when idle. The firmware now parses that timer and reconciles against it, adopting the camera''s real state on reconnect instead of blind-toggling.

That same capture turned up something else: the remote streams GPS to the camera at **10 Hz** as a non-standard NMEA-RMC frame, which is how the in-camera GPS overlay works. The firmware now streams it continuously, golden-tested byte-for-byte against the capture. GPS still logs to SD exactly as before, independently.

### USB mass storage

The Transfer screen now offers **Bluetooth** or **USB**. Choosing USB presents the SD card to a computer as a standard drive for drag-and-drop of logs and track files — no companion app needed. It is opt-in, enumerating only while you are on that page, so ordinary plugging in is unchanged. During a transfer the SD SPI clock is raised from 2 MHz to 8 MHz, lifting the drag-and-drop ceiling to around 250 KB/s. The slow clock exists for ignition-EMI margin, and transfers only happen parked with the motor off, so the tradeoff does not apply there.

### Sleep is now a real shutdown

The software sleep loop is replaced with genuine nRF52 System OFF — the device tears everything down and powers off to microamps. A tachometer pulse, any button, or plugging in USB wakes it with a fresh boot, which makes a physical power switch unnecessary. Charging is the one exception: with USB power present it stays in a live charging loop.

### A GPS status page, and rescuing blank cards

Every boot now lands on a MyChron-style satellite status page: used-in-solution and tracked counts, HDOP, lock state, constellation mode, battery, and one vertical signal bar per satellite from UBX-NAV-SAT. It holds but never locks — any button skips it, and a stable lock auto-advances.

For soldered-in SD modules that can never be pulled and formatted on a PC, a card with no mountable filesystem now lands on an on-device **SD format page** (hold Select for 3 s) instead of a dead-end fault screen. The `/TRACKS` folder is also created automatically when missing.

### The simulator

The real firmware sources now compile and run on a desktop toolchain, then to WebAssembly for the browser. It renders through the **real** Adafruit display stack, so every framebuffer pixel comes from the real `drawPixel()`, verified against committed golden fixtures in CI. GPS frames are injected as genuine `UBX_NAV_PVT` structs, the tachometer as synthesized pulses through the real ISR.

The headline proof: a real device-recorded 13-lap session is replayed through the simulator in CI, and its lap timer must reproduce the lap list from the file''s own header — it matches **all 13 hardware lap times to the exact millisecond**. That is the definitive same-code-same-answer check, and it is what makes the simulator on the LapWing site trustworthy rather than decorative.

### Why it is a major version

Three breaking changes under this project''s semver policy: the sleep model becomes a full power-down, two user-visible modes are removed (the dead Wokwi target and the 24-hour periodic GPS fix during sleep, which nothing can schedule during System OFF), and the BLE file-command protocol adds `BUSY` back-pressure.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v3.0.0)
', '2026-07-18T02:01:18Z'::timestamptz),

  --  9. v3.0.1
  ('firmware-v3-0-1-sensoregg-egt-and-a-track-day-bug-hunt', 'Firmware v3.0.1 — SensorEgg EGT and a Track-Day Bug Hunt', 'v3.0.1 comes largely out of one field session on July 19 that went wrong in two separate ways, plus a proof-of-concept for wireless exhaust-gas temperature. It is a good illustration of why you test on an actual kart.

### Two field incidents

- **Pull-start lockup.** A failed first start, or killing the motor before GPS acquired its time lock, left the device apparently frozen: pinned to the RPM page, all buttons dead, no watchdog reset. The GPS-lock hold that pins the UI while a session waits for a lock latched on **any** tach pulse — pull-cord ignition blips included — and had no engine-off release, while both of its automatic escapes were blocked. The hold now releases after 10 seconds of engine-off, the pinned page says `WAITING GPS LOCK..` instead of pinning silently, and auto-idle may end a still-fileless session even while the camera records.
- **The menu powered itself off mid-session.** The five-minute idle timer read the buttons'' `pressed` flags at a point in the loop where they are always false, so navigating the menu never reset the clock and the device shut down five minutes after entering the menu no matter what you did. It now anchors on the debouncer''s persistent timestamps.

Related, and nastier because it was silent: **track detection was quietly degrading to Lap Anything** whenever logging started first. Track parsing was denied while logging held the SD card — but logging holds it for the entire session, so any boot where the log file was created before the track-detect parse lost course detection for the whole run. Track and settings reads now nest under the logging hold without taking ownership; they run on the same main-loop task with their own file handles, so the exclusion was never protecting anything.

### The dropped-PVT hunt

About 0.9% of 25 Hz GPS frames were being lost in the field, and it was invisible on-device. Bluetooth radio interrupts can defer the GPS drain, and at 57600 baud the core''s stock 64-byte serial ring gave only about 1 ms of slack before bytes were silently dropped. Three changes: the drain runs every 5 ms instead of 10, the ring grows to 256 bytes (about 44 ms of slack) via a required build flag that fails the compile if missing, and the SensorEgg scan duty drops from 60% to 44% so there is less radio time deferring the drain.

The pipeline now also carries permanent **drop instrumentation** — missing frames against the nav-rate expectation, worst-case drain deferral in microseconds, largest single drain burst against ring capacity, and overflow counts — surfaced on the GPS debug page. The regression was invisible once; it will not be again.

### SensorEgg wireless EGT (proof of concept)

The logger passively scans for a DovesSensorEgg — a wireless thermocouple pod broadcasting exhaust-gas and cold-junction temperature in BLE advertising packets at about 10 Hz. Passive observer only: no scan requests, no connection, no GATT link, so it cannot contend with the camera for airtime. New `Temp1` / `Junction1` DOVEX columns and a Temp1 race page.

A dropout logs the literal `nan` rather than holding the last value, which matters: a held flat line is indistinguishable from real data. That principle got tested immediately — a **zombie egg** whose application hangs keeps rebroadcasting its last payload autonomously at 10 Hz, so the logger showed a healthy link with a value that never changed. It now watches the payload''s sequence counter, and if packets keep arriving while the sequence stops advancing, readings go NaN and the page shows `rf:HUNG`.

### Build flags

Two new flags in `project.h`, both off by default on release. **Onboard charging** is off because the hardware now carries an external charging circuit — the XIAO''s onboard charger tops out around 100 mA even held in fast-charge, which is too slow to be useful. **SensorEgg** is off outside the beta channel, because a proof of concept belongs where proofs of concept belong; with it off, Bluetooth returns to coming up lazily instead of at boot, recovering the idle power an always-on radio costs.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataLogger/releases/tag/v3.0.1)
', '2026-07-26T02:27:21Z'::timestamptz)
) as v(slug, title, body, published_at)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Verify: expect 9 rows, newest first.
-- ---------------------------------------------------------------------------
-- select published_at, slug, title, tags from public.posts
--   where 'fledgling' = any(tags) order by published_at desc;
