# Plan: SD-staged firmware update ("BirdsEye OTA")

Status: **Planning** · Branch: `claude/firmware-bluetooth-dfu-mO0GV` → PR into `BETA`
Scope: **multi-repo** — DovesDataViewer (this repo, web client) **+** DovesDataLogger
(firmware). This doc lives here; the firmware half is a contract for the logger repo.

Supersedes the BLE-DFU approach in
[`docs/plans/firmware-bluetooth-dfu.md`](firmware-bluetooth-dfu.md), which is
**dead on the web** (see below).

---

## Why the original BLE-DFU approach is dead (on the web)

Chrome's Web Bluetooth **GATT blocklist** bans the Nordic **legacy** DFU service
`00001530-1212-efde-1523-785feabcd123` — the exact service the logger's Adafruit
`BLEDfu` exposes (confirmed in nRF Connect on a real device). The blocklist's
stated reason: *"Firmware update services that don't check the update's
signature."* So from **any** browser:

- `optionalServices` silently drops the DFU UUID → it never enters the grant.
- `getPrimaryService(DFU)` throws `SecurityError` ("Origin is not allowed…").
- This kills **both** the buttonless trigger **and** the transfer (same service).

Native apps (nRF Connect) are exempt — that's why DFU works there but not on web.
Only **signature-checking** bootloaders (Nordic Secure DFU `0xFE59`, MCUboot/SMP)
are web-allowed.

## Why not just switch to Secure DFU

Installing a secure bootloader is a **cross-family bootloader swap** that needs
**SWD programming pins** — there's no safe wireless/USB path from the Adafruit
legacy bootloader to a Nordic secure one. Our units are **sealed in an enclosure
with no button and no pin access**, and the target UX is **mobile web**. So:
secure DFU is fine for *new factory units* but can't reach the sealed fleet.

## The constraints this plan must satisfy

- **Sealed enclosure**: no SWD pins, no double-tap reset button.
- **Mobile web** (Android Chrome): no Web Serial (desktop-only); USB is out.
- **Wireless only** → **BLE**, over a **non-blocklisted** path.
- Existing units must be reachable **without opening the box**.

---

## Core idea: SD-staged, application-level OTA

The logger already has (a) an **SD card** and (b) a working **web→device file
transfer** over the **custom `0x1820` service** (the `TPUT`/file-write protocol),
which is **not** blocklisted. So we split the job:

1. **Transfer (free, reuses existing code):** the web app downloads the firmware
   image and **writes it to the SD card as a normal file** over `0x1820`. No new
   transport, no blocklist, and it's robust — the image sits on disk and can be
   CRC-verified *before* anything dangerous happens.
2. **Apply (the hard part — firmware):** on an explicit command, the firmware
   installs the staged image into internal flash and reboots into it.

### Transfer + verify handshake (paranoia baked in)

CRC is exchanged and confirmed **both directions before and after** the upload, so
neither the image **nor the agreed-upon checksum itself** can be silently
corrupted in transit. CRC = **CRC-32 (IEEE 802.3)** on both ends.

```
1. [web]   compute crc32(image)
2. [web] → FWBEGIN:<size>,<crc32>                 announce intent + expected CRC
3. [web] ← FWCRC:<crc32>                           logger echoes the CRC it received
          [web] aborts unless the echo == its own  (control channel itself verified)
4. [web] → upload image (chunked file write) → SD  (only after the echo matches)
5. [logger] compute crc32 of the stored SD file
6. [web] ← FWOK:<crc32>  (or FWERR:CRC)            on-device file verified vs expected
7. [web] → FWAPPLY                                 install: stage → flash → reset
8.         …reset → reconnect → read DIS rev → confirm new version
```

Every step is gated on the previous one succeeding; any mismatch aborts **before**
internal flash is ever touched, leaving the running firmware untouched.

```
[web] manifest → download .bin (online)
   │
   ├─(2/3) CRC handshake over 0x2A3E/0x2A40 ──────→ [logger] echoes CRC back
   ├─(4)  BLE 0x1820 file write ─────────────────→ [logger] /fw/pending.bin → SD
   ├─(5/6) on-device CRC verify ←─────────────────  [logger] FWOK / FWERR:CRC
   ├─(7)  FWAPPLY (0x2A3E) ───────────────────────→ [logger] stage → flash → reset
[logger] boots new firmware
   │
[web] (8) reconnect → read DIS firmware rev → confirm new version
```

The nRF52840 executes from **internal flash**, so the image must ultimately land
there — **SD is a staging/verify buffer, not an execution source.**

---

## The apply step (the genuinely hard part)

The stock bootloader is **single-bank** (verified: `adafruit-nrfutil … --singlebank`,
and `DFU_BANK_*` regions exist in the SDK11 bootloader but the Adafruit build does
in-place app writes). Consequences:

- There is **no** "write to bank 1 + set a flag + let the bootloader swap on
  boot" path for the application (that's dual-bank behavior).
- The bootloader **cannot read SD**. Teaching it to = a custom bootloader = SWD
  pins. Out.

So the application has to drive its own replacement. Two candidate strategies —
**Phase 0 spikes decide which is safe** on this exact bootloader build:

### Strategy A — App-resident RAM flasher (leading candidate)
1. App copies `pending.bin` from SD into a **free internal-flash region** (the
   space above the app, ~½ of flash is free; app is ~283 KB of ~830 KB) using the
   SoftDevice flash API, and CRC-verifies it there.
2. App sets the bootloader's **OTA-recovery flag** (`GPREGRET = 0xB1`) *first* so
   that if anything goes wrong the board comes back up in **BLE DFU mode**
   (recoverable — see safety net).
3. App copies a tiny **flasher routine into RAM**, disables the SoftDevice, jumps
   to it; the RAM routine **erases the app region and copies the staged image**
   into it (flash→flash, no SD driver needed in RAM), then resets.
4. Bootloader boots the freshly-written, valid app.

### Strategy B — Reconfigure to a dual-bank bootloader, once, over the air
If A proves too risky, a **one-time** bootloader self-update (Adafruit→Adafruit,
**same family**, so the supported self-update path) to a **dual-bank** build,
pushed via **nRF Connect over BLE** (native, buttonless, no pins/box). Then the
app OTA uses the normal staged-bank swap. Higher migration risk (bootloader
self-update), but a much safer steady state. **Validate feasibility in Phase 0.**

### The safety net (makes A acceptable for sealed units)
A failed/interrupted apply leaves an **invalid app**, so the bootloader enters DFU
mode. The bootloader's **BLE legacy DFU is reachable by nRF Connect** (native, not
blocklisted) — so a "bricked" sealed unit is **recoverable wirelessly, no pins, no
box-opening**, using the same tool we use for fleet migration. *Phase 0 must
confirm the bootloader advertises BLE DFU in the invalid-app state (and whether
the `GPREGRET` pre-set survives the failure modes we care about).*

---

## Phase 0 — hardware spikes (make-or-break, do first)

Cheap to test on a dev unit; everything else depends on the answers:

1. **Invalid-app recovery:** force an invalid app; confirm the bootloader comes up
   and is **flashable over BLE via nRF Connect** (no button/USB/pins). This is the
   safety net the whole plan leans on.
2. **Free-flash write from app:** confirm the app can erase+write the upper flash
   region via the SoftDevice flash API while running (sizes, alignment, timing).
3. **RAM flasher (Strategy A):** prototype the erase-app-region-and-copy routine
   from RAM; confirm it boots the new image. Measure the unsafe window.
4. **(If A is shaky) Dual-bank self-update (Strategy B):** can a dual-bank Adafruit
   bootloader be installed via nRF Connect BLE self-update, no pins?
5. **GPREGRET behavior** across soft-reset vs power-loss in the failure path.

---

## Web-client work (this repo — well-defined regardless of A/B)

Most of the existing `src/lib/ble/dfu/` building blocks **survive**; only the
transport/trigger changes (the blocklisted bits go).

**Reuse as-is:**
- `firmwareManifest.ts` — manifest fetch + `compareVersions` / `pickBuildForVariant`
  / `evaluateFirmwareUpdate` (incl. the beta-branch `force`). No change.
- `dfuPackage.ts` — `parseDfuPackage` already unzips the published `dfuZip` and
  returns `image` (the app `.bin`). **That `.bin` is exactly what we upload to SD.**
- `version.ts` — DIS read for current version + **post-update verification**.

**New / changed:**
- **CRC**: `ble/firmwareCrc.ts` → `crc32(bytes)` (CRC-32/IEEE 802.3), pure +
  unit-tested against known vectors so it provably matches the firmware's CRC.
- **CRC handshake**: `FWBEGIN:<size>,<crc32>` then await `FWCRC:<crc32>` on
  `0x2A40`; **abort unless the echo equals the locally-computed CRC** (verifies the
  control channel before any upload).
- **Upload-to-SD**: stream `pkg.image` to the device as a file over `0x1820`,
  modeled on `ble/trackSync.ts:uploadTrackFile` (chunked `TPUT`-style write). New
  helper, e.g. `ble/firmwareUpload.ts` → `uploadFirmwareImage(conn, bytes, onProgress)`.
  Runs **only after** the CRC echo matches.
- **On-device verify + apply**: await `FWOK:<crc32>` (abort on `FWERR:CRC`), then
  send `FWAPPLY` and watch `0x2A40` for staging/flash progress + result.
- **Orchestration** (`useFirmwareUpdate.ts`): replace `triggerDfuMode` +
  `connectToDfuDevice` + `flashFirmware` with the 8-step handshake: download →
  crc → `FWBEGIN`/await `FWCRC` (verify echo) → `uploadFirmwareImage` →
  await `FWOK` → `FWAPPLY` → wait for device reset → reconnect → re-read DIS →
  verify version. Keep `isFlashing` guard, progress UI, beta-branch `force`,
  error surfacing.
- **Retire the dead code**: `dfuProtocol.ts` (legacy transfer) and the BLE-DFU
  bits of `dfuTransport.ts` (`triggerDfuMode`/`connectToDfu*`) are unreachable on
  web — delete or clearly quarantine. Keep tests for what remains.
- **UI** (`FirmwareUpdateSection.tsx`): same shape (version + Check + confirm +
  progress), progress now covers **Downloading → Uploading to device → Installing
  → Reconnecting → Verified**. Drop the "forget device" recovery (that was for the
  blocklist red herring).

**CRC**: CRC-32/IEEE on both ends, exchanged + echoed *before* the upload and
re-verified on-device *after* it (the handshake above), so the image and the
agreed checksum are both proven before internal flash is touched.

---

## Firmware contract (DovesDataLogger repo — for the logger team)

Built on the existing BLE protocol (`0x1820` service, `0x2A3E` request / `0x2A40`
status). Version reporting via **DIS** is already done.

Commands on `0x2A3E`, responses on `0x2A40`. CRC = **CRC-32/IEEE 802.3**.

- **`FWBEGIN:<size>,<crc32>`** — announce the incoming image + its expected CRC.
  The logger stores them and **echoes back `FWCRC:<crc32>`** so the web app can
  confirm the control channel carried the checksum intact *before* uploading. (May
  also pre-erase/open `/fw/pending.bin` here.)
- **Receive image**: file write to `/fw/pending.bin` via the existing file-write
  protocol (extend `TPUT` or add `FWPUT`), streaming chunks on `0x2A3E`, acked on
  `0x2A40`. Sent only after the web app accepts the `FWCRC` echo.
- **Verify on device**: after the file lands, the logger computes CRC-32 of the
  stored SD file and replies **`FWOK:<crc32>`** (matches `FWBEGIN`) or
  **`FWERR:CRC`** (mismatch → abort; nothing else happens, running app untouched).
- **`FWAPPLY`** — only valid after `FWOK`. Installs the staged image:
  - `0x2A40`: `FWSTAGE:<pct>` (copy SD → free internal flash, re-CRC there), then
  - `FWREADY` → set `GPREGRET=0xB1` recovery flag → run the RAM flasher → reset.
  - On reboot the new app advertises again; the web client confirms via DIS.
- **Safety**: refuse if battery below threshold (reuse `BATT`); a variant/magic
  check + the CRC gate above; **never erase the app region until the staged copy is
  CRC-verified in flash**; every step abortable, with the running firmware
  untouched until the final flasher runs.
- **(Apply strategy A vs B decided in Phase 0.)**

---

## Migrating the existing sealed fleet (one-time, no pins, no box)

Ship the **first** OTA-capable firmware (the version that adds `FWPUT`/`FWAPPLY`)
to existing units **via nRF Connect over BLE** — native app, buttonless trigger
works, blocklist doesn't apply. That's a **normal app update on the existing
bootloader** (low risk; no bootloader swap). After that one push, **all** future
updates go through the web app. New production can ship this firmware from the
factory.

---

## Packaging / manifest

No manifest change needed: keep publishing the existing per-variant `dfuZip`; the
client extracts the app `.bin` from it (`dfuPackage.parseDfuPackage`). Optionally
publish a raw `.bin` + `crc32` later to skip the unzip. Variant is matched via the
DIS model (`BirdsEye-<variant>`) exactly as today.

---

## Phasing

- **Phase 0** — hardware spikes (above). Decide Strategy A vs B and confirm the
  BLE recovery net. *Nothing else starts until these pass.*
- **Phase 1 (firmware)** — `FWBEGIN` (+ `FWCRC` echo), `FWPUT` receive-to-SD,
  on-device verify (`FWOK`/`FWERR:CRC`), `FWAPPLY` (stage → flash → reset) +
  battery/variant guards.
- **Phase 2 (web)** — `firmwareCrc.ts` (CRC-32, unit-tested to match firmware) +
  `firmwareUpload.ts`, rework `useFirmwareUpdate` to the
  download → crc → handshake → upload → verify → apply → reconnect → confirm flow,
  update the UI, retire the dead DFU transport.
- **Phase 3 (polish)** — resume/retry of a partial SD upload, signed images
  (optional, our own signature since Chrome doesn't force it here), progress/ETA,
  changelog/README/CLAUDE updates.

---

## Open questions / risks

- **Apply safety (biggest):** does the single-bank self-flash (Strategy A) leave a
  reliably **BLE-recoverable** state on every failure mode? Phase 0 must prove the
  nRF-Connect recovery net before we ship to sealed units.
- **Dual-bank self-update (Strategy B):** feasible over BLE without pins? Lower
  steady-state risk if so.
- **Bootloader settings format** (if we end up needing it) is version-coupled —
  but we own the bootloader build, so it's knowable.
- **Power during apply:** gate on battery; keep the unsafe window minimal.
- This is **firmware-heavy** and crosses repos; the web side is the smaller, lower-
  risk half and reuses most of `src/lib/ble/dfu/`.
