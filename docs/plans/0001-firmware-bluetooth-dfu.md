# Plan: Firmware update over Bluetooth (BLE DFU)

Status: **Planning** · Branch: `claude/firmware-bluetooth-dfu-mO0GV` → PR into `BETA`

Goal: let a user update their **DovesDataLogger** firmware straight from the web
app over Web Bluetooth — *check the installed version → fetch the latest build →
reboot the device into its bootloader → flash the new image → verify*, with a
progress UI, all without any desktop tool (`adafruit-nrfutil`, nRF Connect, etc.).

UI is still **TBD** (the maintainer is designing it). This doc locks the
*technical* plan — protocol, library choice, module layout, online/offline
behaviour, testing — so the UI can be dropped on top of a stable seam.

---

## What the hardware actually is (investigated, not assumed)

The companion logger is an **nRF52840** board (Seeed XIAO nRF52840). The OTA
manifest publishes two variants:

| Build | `variant` | Board | Notes |
|-------|-----------|-------|-------|
| `BirdsEye-sense` | `sense` | XIAO nRF52840 **Sense** | has the on-board IMU |
| `BirdsEye-nonsense` | `nonsense` | XIAO nRF52840 | no IMU |

> The logger runs the **Adafruit nRF52 Arduino core** (`Adafruit_nRF52_Arduino` /
> `Adafruit_nRF52_Bootloader`). The CLAUDE.md "ESP32" line was wrong and is fixed
> in this PR.

### The firmware already exposes everything via *standard* BLE services

Reading the published firmware (`BirdsEye/bluetooth.ino`, `BLE_SETUP()`) confirms
it advertises **standard** Bluetooth services for version + DFU — there is **no
new/custom characteristic** to add, and **no firmware change is needed** for this
feature:

```cpp
BLEDfu bledfu;   // buttonless DFU trigger (standard Adafruit service)
BLEDis bledis;   // Device Information Service (0x180A)
...
bledfu.begin();
bledis.setManufacturer("DovesDataLogger");
bledis.setModel("BirdsEye-" FIRMWARE_VARIANT);  // -> "BirdsEye-sense" / "BirdsEye-nonsense"
bledis.setFirmwareRev(FIRMWARE_VERSION);        // -> e.g. "2.1.0"
bledis.begin();
```

So both the installed version **and** the variant come straight off the standard
**Device Information Service**, and DFU mode is entered via the standard
**Adafruit buttonless DFU** service — the app just consumes them.

### The OTA manifest (`https://theangryraven.github.io/DovesDataLogger/manifest.json`)

```jsonc
{
  "version": "2.1.0",
  "releaseTag": "v2.1.0",
  "publishedAt": "2026-06-06T06:10:26Z",
  "releaseNotes": "https://github.com/.../releases/tag/v2.1.0",
  "builds": {
    "BirdsEye-sense":    { "variant": "sense",    "dfuZip": ".../firmware/2.1.0/BirdsEye-sense.zip" },
    "BirdsEye-nonsense": { "variant": "nonsense", "dfuZip": ".../firmware/2.1.0/BirdsEye-nonsense.zip" }
  }
}
```

Served from **GitHub Pages**, which sends `access-control-allow-origin: *`, so a
browser `fetch()` of both the manifest **and** the `.zip` works cross-origin — no
proxy needed.

### The DFU package format — **legacy Adafruit nRF52 DFU, not Secure DFU**

Unzipping a `dfuZip` reveals the classic `adafruit-nrfutil` package:

```
BirdsEye.ino.bin     (~283 KB application image)
BirdsEye.ino.dat     (14-byte legacy init packet)
manifest.json        (inner DFU manifest)
```

Inner `manifest.json`:

```jsonc
{
  "manifest": {
    "application": {
      "bin_file": "BirdsEye.ino.bin",
      "dat_file": "BirdsEye.ino.dat",
      "init_packet_data": {
        "application_version": 4294967295,
        "device_revision": 65535,
        "device_type": 82,
        "firmware_crc16": 50892,
        "softdevice_req": [291]
      }
    },
    "dfu_version": 0.5
  }
}
```

`dfu_version: 0.5` + a **14-byte** `.dat` init packet + `firmware_crc16` is the
**legacy** Nordic DFU (SDK-11-era) that the **Adafruit nRF52 bootloader** speaks.
This is the single most important finding: it rules out the obvious off-the-shelf
web library (see next section).

### Bootloader / build toolchain (verified against the Seeed package)

For reference (and so a future maintainer can reproduce a build), the board is a
**Seeed XIAO nRF52840 / Sense** built with the **"Seeed nRF52 Boards"** Arduino
package — Seeed's fork of `Adafruit_nRF52_Arduino` (Bluefruit) — **not** the
"Seeed nRF52 **mbed-enabled** Boards" package (Mbed OS has no Bluefruit/`BLEDfu`,
so the firmware wouldn't build there). The matching bootloader is the
**Adafruit-style nRF52 UF2 bootloader, version `0.6.2`, SoftDevice `S140 7.3.0`**:

- `Seeed_XIAO_nRF52840_bootloader-0.6.2_s140_7.3.0` (plain)
- `Seeed_XIAO_nRF52840_Sense_bootloader-0.6.2_s140_7.3.0` (Sense)

This cross-checks the OTA package exactly: the package's `device_type: 82` =
`adafruit-nrfutil … --dev-type 0x0052`, and `softdevice_req: [291]` = `0x0123` =
**S140 7.3.0** (`sd_fwid=0x0123`). The Arduino upload recipe is
`adafruit-nrfutil dfu` (**legacy**, not Secure) — independent confirmation of the
library decision below.

> **Flasher implication:** the bootloader enforces a SoftDevice-requirement
> (`sd-req`) check on incoming images. Firmware + bootloader are both pinned to
> S140 7.3.0, so images are accepted — but the flasher must surface a clear error
> if the device ever rejects on `sd-req` mismatch (a board on an older
> SoftDevice/bootloader).

---

## Library evaluation ("there should be some JS library…")

| Option | DFU flavour | Verdict |
|--------|-------------|---------|
| **`web-bluetooth-dfu`** (Rob Moran / thegecko, npm) | **Secure DFU** only (service `0xFE59`, signed/protobuf init packet) | ❌ **Mismatch.** Our packages are *legacy* DFU. Would only work if we re-flashed the device with a Secure DFU bootloader — a hardware/firmware migration out of scope here. |
| Nordic `pc-nrf-dfu-js` | Secure DFU, Node-oriented (serial + BLE) | ❌ Node/Electron-shaped, secure-only, heavy. |
| **Roll our own legacy DFU client** | Legacy (matches our packages) | ✅ **Recommended.** ~200 LOC, no maintained browser lib exists for legacy DFU, and it fits this repo's "we write our own BLE protocols" convention (see `src/lib/ble/`). |

**Decision: implement a small legacy-DFU-over-Web-Bluetooth client in-repo.**
Reasons: (1) the package format is legacy and no good browser library targets it;
(2) the repo already hand-rolls every BLE protocol (file/settings/track) in
`src/lib/ble/`, so this is idiomatic; (3) zero new runtime deps — **`jszip` is
already a dependency** for unpacking the `.zip`; (4) offline-first friendly (no
vendored binary blobs, pure JS).

> Alternative kept on the table: migrate the firmware to a **Secure DFU**
> bootloader and adopt `web-bluetooth-dfu`. Cleaner long-term (maintained lib,
> signed images) but a bootloader change on already-shipped hardware. Document it;
> don't block this work on it.

---

## The four capabilities, mapped to a design

### 1. Check the installed version — **standard Device Information Service**

Read the **DIS** (`0x180A`), no custom characteristic:

| Field | Characteristic | Example | Use |
|-------|----------------|---------|-----|
| Firmware Revision | `0x2A26` | `"2.1.0"` | semver-compare vs manifest `version` |
| Model Number | `0x2A24` | `"BirdsEye-sense"` | **maps 1:1 to a manifest `builds` key** → picks the variant's `dfuZip` |
| Manufacturer | `0x2A29` | `"DovesDataLogger"` | sanity / display |

The DIS is a separate primary service from the app's `0x1820`, so read it off the
same `BluetoothRemoteGATTServer` (`server.getPrimaryService(0x180A)` →
`getCharacteristic(0x2A26)` → decode UTF-8). Compare with semver ordering to
decide "up to date" vs "update available". **Important:** request `0x180A` in the
`optionalServices` of the existing `connectToDevice()` call so Web Bluetooth
grants access to it on the same connection (no second picker just to read the
version).

### 2. Trigger DFU (reboot into bootloader) — **standard Adafruit buttonless DFU**

The firmware's `BLEDfu` advertises the standard Adafruit buttonless DFU service
(confirmed against `Adafruit_nRF52_Arduino`):

| Role | UUID |
|------|------|
| DFU service | `00001530-1212-EFDE-1523-785FEABCD123` |
| DFU control point | `00001531-1212-EFDE-1523-785FEABCD123` (write + notify/indicate) |
| DFU packet | `00001532-1212-EFDE-1523-785FEABCD123` |
| DFU revision | `00001534-…` (reads `0x0001` = "in app mode") |

Flow: connect → get the DFU service → enable notifications on the control point →
**write the start opcode (`0x01`) to the control point**. The firmware sets
`GPREGRET = 0xB1` (DFU_OTA_MAGIC) and resets; the board reboots into the
**bootloader**, which re-advertises the *same* legacy DFU service for the actual
transfer.

> The bootloader re-advertises under a different name + the DFU service, so the
> reconnect uses a fresh `requestDevice({ filters: [{ services: [DFU_SERVICE] }] })`.
> Web Bluetooth requires a **user gesture** per `requestDevice`, so the UI must
> surface a "select the device (now in DFU mode)" step — or lean on persisted
> `navigator.bluetooth.getDevices()` permission to skip the second picker.

### 3. Download the firmware locally

`fetch(manifest)` → pick `builds[<deviceVariant>].dfuZip` → `fetch(zipUrl)` →
`jszip` unpack → read `manifest.json` (inner) + the `.dat` + `.bin` as
`Uint8Array`s. Validate the inner manifest shape (`dfu_version`, `application`,
files present). This is **online-only** (a documented exception alongside weather
/ tiles / admin — firmware binaries can't ship in the offline bundle). Optionally
let the user pick a local `.zip` for fully-offline / sideload flashing.

### 4. Flash (legacy DFU transfer)

In the bootloader, the **same** legacy DFU service is used for the transfer
(confirmed against `Adafruit_nRF52_Bootloader`, SDK11-era legacy DFU):

| Role | UUID |
|------|------|
| DFU Service | `00001530-1212-EFDE-1523-785FEABCD123` |
| Control Point (CP) — write + notify | `00001531-1212-EFDE-1523-785FEABCD123` |
| Packet — write-without-response | `00001532-1212-EFDE-1523-785FEABCD123` |

Procedure (op codes on CP, image bytes on Packet):

1. `startNotifications()` on CP.
2. **Start DFU**: CP ← `[0x01, 0x04]` (0x04 = application image).
3. **Image sizes**: Packet ← 12 bytes `[sd=0, bl=0, app=binLen]` (LE u32 each).
4. Await CP notify `0x10 0x01 0x01` (success).
5. **Init params (receive)**: CP ← `[0x02, 0x00]`; Packet ← the 14-byte `.dat`;
   CP ← `[0x02, 0x01]` (complete). Await success.
6. (optional) **PRN**: CP ← `[0x08, n_lo, n_hi]` for packet-receipt pacing.
7. **Receive image**: CP ← `[0x03]`, then stream `.bin` in MTU-sized chunks
   (~20 B, or negotiated MTU) to Packet, honouring PRN receipts. Emit progress.
8. Await image-received success.
9. **Validate**: CP ← `[0x04]`. Await success.
10. **Activate & reset**: CP ← `[0x05]`. Device reboots into the new app.

Errors map CP response codes (`0x10 <op> <status>`) to friendly messages; a
mid-flash failure leaves the device safely in the bootloader (re-flashable).

---

## Module layout (fits `src/lib/ble/` conventions)

```
src/lib/ble/dfu/
├── dfuTypes.ts        # DfuPackage, DfuProgress, DfuVariant, op-code/status enums
├── dfuPackage.ts      # PURE: unzip (jszip) + parse/validate inner manifest → {initPacket, image, meta}
├── dfuProtocol.ts     # legacy DFU state machine over a BleConnection-like CP/Packet pair
├── firmwareManifest.ts# fetch + parse top-level manifest; semver compare; pick build by variant (PURE compare)
├── version.ts         # read DIS (0x180A): firmware rev 0x2A26 + model 0x2A24 -> {version, variant}
├── index.ts           # public barrel (checkFirmware, downloadFirmware, enterDfuMode, flashFirmware)
└── __test__/          # vitest for the PURE bits (package parse, manifest pick, semver, init-packet build)
```

- `firmwareManifest.ts` constant for the manifest URL (with an env override
  `VITE_FIRMWARE_MANIFEST_URL` if we want preview/staging manifests — document in
  README + CLAUDE.md env table if added).
- Add `0x180A` to `optionalServices` in `connectToDevice()` so the DIS version
  read works on the existing connection (no extra picker). The DFU-mode connection
  is a *separate* device session (post-reboot) — add a `connectToDfu()` alongside
  `connectToDevice()` rather than overloading the latter.
- Keep `dfuPackage.ts` / `firmwareManifest.ts` **pure** so they're unit-testable
  without BLE (Golden Rule #6). The protocol state machine is exercised with a
  mocked characteristic pair (same pattern as `fileTransfer.test.ts`).

---

## UI integration points (mechanism only — visual design TBD)

- **New Device sub-tab "Firmware"** (`src/components/drawer/DeviceFirmwareTab.tsx`)
  next to Settings/Tracks, behind the existing "Connect to Logger" gate. Shows:
  installed version + variant, latest version (online), Update / "Up to date"
  state, a flashing progress bar, and a sideload-`.zip` option.
- **`DeviceContext`** gains the DFU lifecycle (it already centralises connect/
  disconnect): `enterDfuAndReconnect()`, current DFU phase/progress, so the
  flashing survives tab switches like the BLE connection does.
- Surface an **"update available"** affordance wherever the device is shown
  (e.g. a dot on the Device tab) once a newer manifest version is detected online.
- Strong **safety copy**: keep the device close, don't close the tab, battery
  warning (gate on `requestBatteryLevel()` ≥ some threshold before flashing).

---

## Offline-first & safety

- Reading the installed version and flashing a **user-provided local `.zip`** work
  fully offline. Only **fetching the published manifest + binary** needs network —
  a documented exception (like weather/tiles/admin), behind `useOnlineStatus`.
- Never auto-flash. Explicit user action, explicit variant match (refuse to flash
  a `sense` image to a `nonsense` device and vice-versa), battery check first.
- A failed/interrupted flash leaves the device in the bootloader (recoverable);
  the UI should detect "device is already in DFU mode" on next connect and offer
  to resume/retry.

---

## Firmware side — already done

**No firmware change is required.** The shipped firmware (`BirdsEye/bluetooth.ino`,
`BLE_SETUP()`) already advertises the standard `BLEDis` (version + variant) and
`BLEDfu` (buttonless DFU) services. The app is a pure consumer of standard BLE.

The app should still **degrade gracefully** for older units that predate these
services: no DIS → "version unknown, can't auto-check" (offer manual/sideload
flash); no buttonless DFU service → instruct the manual bootloader entry
(double-tap reset).

> Naming note: the firmware comment calls `BLEDfu` "Secure DFU", but the Adafruit
> `BLEDfu` service + bootloader are the **legacy** SDK11 DFU (consistent with the
> `dfu_version 0.5` package). Treat it as legacy; the comment is cosmetic.

---

## Phasing

- **Phase 1** — `dfuPackage` + `firmwareManifest` (pure, tested) + `dfuProtocol`
  state machine against a mocked CP/Packet; version read via DIS; a minimal
  Firmware tab that checks version and flashes. Online manifest fetch.
- **Phase 2** — polish: progress/ETA reuse of `format.ts`, battery gate, sideload
  `.zip`, "update available" badge, resume-from-bootloader, MTU negotiation/PRN
  tuning for speed.
- **Phase 3** — (optional) evaluate migrating firmware to Secure DFU +
  `web-bluetooth-dfu` for signed images.

---

## Docs to update when code lands

- **CLAUDE.md**: "ESP32" → "nRF52840" (done in this PR); add `src/lib/ble/dfu/` to
  the architecture map + a "Firmware DFU" section; note the standard DIS (`0x180A`)
  + buttonless DFU (`0x1530…`) services in the BLE section; any new env var.
- **README.md**: a "Firmware update" user section; env var table if
  `VITE_FIRMWARE_MANIFEST_URL` is added; credits (none new — `jszip` already
  credited).
- **CHANGELOG.md**: user-facing "Update logger firmware over Bluetooth" under
  `[Unreleased]` when the feature ships (not for this plan-only PR).

---

## Open questions for the maintainer

_(Version source + DFU trigger are now settled — both are standard services
already in the firmware.)_

1. **Reconnect UX**: the bootloader needs a second `requestDevice` (user gesture).
   Acceptable, or do we want to lean on persisted `getDevices()` permission to
   auto-reconnect after the reboot?
2. **Manifest URL**: hardcode the GitHub Pages URL, or make it env-configurable
   (`VITE_FIRMWARE_MANIFEST_URL`) for preview firmware channels?
3. **Long-term**: any appetite for moving the firmware to true Secure DFU + the
   `web-bluetooth-dfu` library (Phase 3), or stay on legacy?
