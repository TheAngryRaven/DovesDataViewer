# BLE / Device Reference

Web Bluetooth integration with the **DovesLapTimer** (nRF52840) hardware: file
transfer, settings, track sync, battery, and the SD-staged firmware OTA. Kept out
of `CLAUDE.md` so it loads only when working on device code. Global BLE connection
state lives in `DeviceContext.tsx` (wraps the app tree in `Index.tsx`). Source:
`src/lib/ble/` (split per-concern; `bleDatalogger.ts` is the legacy barrel).
Everything here is lazy-loaded — `DataloggerDownload` is the BLE entry point so
`lib/ble/*` stays out of the initial bundle.

---

## GATT characteristics

| UUID | Characteristic | Purpose |
|------|---------------|---------|
| `0x1820` | Service | Internet Protocol Support (container) |
| `0x2A3D` | File List | Read: newline-separated `filename,size` pairs |
| `0x2A3E` | File Request | Write: `GET:filename`, `LIST`, `SLIST`, `SGET:key`, `SSET:key=value`, `SRESET`, `TLIST`, `TGET:name`, `TPUT:name`, `TDEL:name`, `BATT` |
| `0x2A3F` | File Data | Notify: chunked file data (reassembled client-side) |
| `0x2A40` | File Status | Notify: `SIZE:n`, `DONE`, `ERROR:msg`, settings (`SVAL`, `SEND`, `SOK`, `SERR`), tracks (`TFILE`, `TEND`, `TREADY`, `TOK`, `TERR`), battery (`BATT:<pct>,<volt>`) |

## Protocols

**File** — LIST → select file → `GET:filename` → receive SIZE → stream data chunks
→ DONE.

**Settings** (schema in `src/lib/deviceSettingsSchema.ts` — maps keys to labels/
types/validation; unknown keys display as raw string fields, forward-compatible):
- `SLIST` → device sends `SVAL:key=value` per setting on fileStatus, ends with `SEND`
- `SGET:key` → `SVAL:key=value` or `SERR:NOT_FOUND`
- `SSET:key=value` → `SOK:key` or `SERR:WRITE_FAIL`
- `SRESET` → `SOK:RESET`, then reboots. App should disconnect immediately after.

**Track files**:
- `TLIST` → `TFILE:name.json` per file, ends with `TEND`
- `TGET:name.json` → reuses SIZE → data chunks → DONE transfer pattern
- `TPUT:name.json` → `TREADY` → app sends data chunks on fileRequest (64-byte max) →
  `TDONE` → device responds `TOK` or `TERR:reason`
- `TDEL:name.json` → `TOK` (success) or `TERR:reason` (failure). 10s timeout.

**Battery**: `BATT` → `BATT:<percent>,<voltage>` (e.g. `BATT:85,3.98`). 5s timeout.

---

## Device Track Sync (`src/lib/deviceTrackSync.ts`)

Pure comparison/conversion logic for merging app tracks with device track files:
- `buildMergedTrackList()` — matches tracks by shortName, courses by name,
  classifies as synced/mismatch/device_only/app_only
- `coursesMatch()` — coordinate comparison with epsilon (0.0000005°)
- `buildTrackJsonForUpload()` — serializes app Track to device JSON (flat course
  array, includes `lengthFt`)
- `deviceCourseToAppCourse()` / `appCourseToDeviceJson()` — format converters (both
  include `lengthFt`)
- `DeviceCourseJson` includes `lengthFt?: number` for hardware course detection by
  lap distance

---

## Device Manager (drawer)

The slide-out drawer (`FileManagerDrawer.tsx`) opens full-width on mobile, half on
desktop (`w-full sm:w-1/2`) with three top-level tabs:
- **Garage** — Files, Karts, Setups, Notes
- **Profile** — account, storage, lap snapshots, data export (plugin panels; see
  `CLAUDE.md` Plugin Framework)
- **Device** — BLE management, gated behind a "Connect to Logger" prompt

Device sub-tabs:
- **Settings** — read/write device settings via SLIST/SGET/SSET; firmware update UI
  at the top (`drawer/FirmwareUpdateSection.tsx`)
- **Tracks** — full track sync manager: downloads all device track JSONs, merges
  with app tracks, shows sync status per track/course, supports upload/download/diff
  with a side-by-side comparison modal

---

## Firmware update over BLE — SD-staged OTA (`src/lib/ble/dfu/` + `firmware*.ts`)

The logger (Seeed XIAO nRF52840, Adafruit nRF52 core) is updated in-app over Web
Bluetooth. **Legacy/Secure BLE DFU is impossible from a browser** — Chrome's Web
Bluetooth blocklist bans the Nordic legacy DFU service, and a Secure-DFU bootloader
needs SWD pins (sealed units). So instead the image is **staged on the device's SD
card over the existing `0x1820` file service** (not blocklisted), and the device
verifies it by CRC and installs it itself. Full design + firmware contract:
[`plans/firmware-sdcard-ota.md`](plans/firmware-sdcard-ota.md). The dead BLE-DFU
investigation: [`plans/firmware-bluetooth-dfu.md`](plans/firmware-bluetooth-dfu.md).

- **Check version** — read the standard **Device Information Service** (`0x180A`):
  Firmware Revision (`0x2A26`) → version, Model Number (`0x2A24`,
  `"BirdsEye-<variant>"`) → variant (selects the manifest build). `dfu/version.ts`;
  `0x180A` is in `connectToDevice()`'s `optionalServices`.
- **Manifest** — `dfu/firmwareManifest.ts`: fetch the online OTA index via
  `getManifestUrl()` — `VITE_FIRMWARE_MANIFEST_URL` override > the **beta channel**
  (`.../DovesDataLogger/beta/manifest.json`) on non-`main`/preview builds
  (`isPreviewBuild()`) > production (`.../DovesDataLogger/manifest.json`) — + pure
  `compareVersions`/`isUpdateAvailable`/`pickBuildForVariant`/
  `evaluateFirmwareUpdate`. Each build carries `appBin` (raw `.bin` URL) +
  `appCrc32` + `appSize`; `assertImageMatchesBuild` verifies a download against them
  (first link of the full-circle CRC chain, pure). Online-only.
- **Package** — `dfu/dfuPackage.ts`: `jszip` unzip of a `dfuZip` → `{ image (.bin),
  … }`. Only the **fallback** path now (older manifests without `appBin`); the
  normal flow downloads the raw `appBin` directly.
- **CRC** — `ble/firmwareCrc.ts`: `crc32`/`crc32Hex` (CRC-32/IEEE, known-vector
  tested so it matches the firmware byte-for-byte).
- **Transfer protocol** — `ble/firmwareUpload.ts` over `0x2A3E`/`0x2A40`, the
  paranoid handshake: `beginFirmwareUpdate` (`FWBEGIN:<size>,<crc>,<variant>` →
  `FWCRC` echo, abort on mismatch; wrong variant rejected with `FWERR:VARIANT`) →
  `uploadFirmwareImage` (`FWPUT`→`FWREADY`→chunks→`FWDONE`→on-device verify
  `FWOK`/`FWERR`) → `applyFirmware` (`FWAPPLY`→`FWSTAGE`→`FWAPPLIED`). Upload uses a
  per-chunk watchdog (no total-time cap). Mock-BLE tested.

UI: top of **Device → Settings** (`drawer/FirmwareUpdateSection.tsx`): installed
version + **Check for updates** → confirm dialog (battery warnings) → progress
(download → upload → verify → install) → auto-disconnect. Orchestrated by
`hooks/useFirmwareUpdate.ts`; the install is marked on `DeviceContext`
(`isFlashing`/`setFlashing`) so the expected BLE drop when the device reboots into
the new firmware doesn't tear down the UI mid-update.

On **beta/preview builds** (`isPreviewBuild()`, any non-`main` branch),
`evaluateFirmwareUpdate(…, { force: true })` **bypasses the version check** so a
matching build is always offered (testers can re-flash the same/older version); the
confirm dialog shows an amber "on beta branches updates always push through for
testing" note.
