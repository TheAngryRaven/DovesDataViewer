# DovesDataLogger BLE Protocol — Full Wire Specification

> **Purpose.** A complete, transport-agnostic description of the DovesDataLogger
> (a.k.a. *Fledgling* / *BirdsEye*) Bluetooth Low Energy connection stack: every
> GATT service, characteristic, command, and response packet. The goal is that
> **anyone** — the Tauri/native shell, a Python script, a mobile app, firmware
> tests — can replicate the connection and transfer flows **without** reading the
> TypeScript. The web client (`src/lib/ble/`) is the reference implementation, but
> nothing here is web-specific.
>
> **Keep this in sync.** This document is the authoritative protocol contract. Any
> change to the BLE wire format — new command, new response token, changed
> characteristic, changed chunking/timeout, new service — **must** be reflected
> here in the same change, alongside the firmware (DovesDataLogger repo) and the
> reference client (`src/lib/ble/`). If you touch a packet, you touch this file.

---

## 1. Roles & transport

- **Peripheral (server):** the DovesDataLogger — Seeed XIAO **nRF52840**, Adafruit
  nRF52 Arduino core, running an Adafruit `BLEUart`-style custom service plus the
  standard Device Information Service. Variants: `sense` / `nonsense` (IMU
  presence); the variant is part of the firmware model string.
- **Central (client):** the app (web via Web Bluetooth, or any GATT central — a
  native Tauri shell using `btleplug`, `bleak` in Python, `CoreBluetooth`, etc.).

The peripheral acts as a **GATT server**. The client **writes commands** to a
request characteristic and **subscribes to notifications** on data/status
characteristics. All multi-message exchanges are asynchronous: send a command,
then collect notifications until a terminator token arrives.

### 1.1 Text encoding

All commands and all status/list tokens are **UTF-8 / ASCII text**. File and
firmware *payloads* are **raw binary**. The client decodes notification bytes as
UTF-8 for the control channels and treats data-channel notifications as opaque
bytes.

> **Multi-token notifications.** The firmware may pack several newline-separated
> tokens into a single notification, *and* a terminator may arrive batched onto the
> tail of a data segment (e.g. `…|END`). Robust clients **accumulate** and split on
> `\n` (control) or anchor terminators at end-of-buffer — never assume one
> notification == one token.

---

## 2. GATT profile

### 2.1 Custom file/control service — `0x1820`

The primary service. UUID `0x1820` ("Internet Protocol Support" 16-bit assigned
number, reused as an opaque container — there is no IPSP semantics here).

| 16-bit UUID | Full 128-bit UUID | Name | Properties | Direction | Purpose |
|---|---|---|---|---|---|
| `0x1820` | `00001820-0000-1000-8000-00805f9b34fb` | **Service** | — | — | Container for the four characteristics below |
| `0x2A3D` | `00002a3d-0000-1000-8000-00805f9b34fb` | **File List** | Notify | device → client | Log-file list chunks (`LIST` response) |
| `0x2A3E` | `00002a3e-0000-1000-8000-00805f9b34fb` | **File Request** | Write | client → device | **All commands** + uploaded payload chunks |
| `0x2A3F` | `00002a3f-0000-1000-8000-00805f9b34fb` | **File Data** | Notify | device → client | Binary file payload chunks (downloads) |
| `0x2A40` | `00002a40-0000-1000-8000-00805f9b34fb` | **File Status** | Notify | device → client | Status/terminator tokens for **every** protocol |

> **16→128-bit expansion.** Web Bluetooth accepts the bare 16-bit numbers. Native
> stacks (btleplug, bleak, CoreBluetooth) usually need the **full 128-bit** form:
> take the Bluetooth SIG base UUID `0000xxxx-0000-1000-8000-00805f9b34fb` and slot
> the 16-bit value into `xxxx`. The full UUIDs are listed above; use them verbatim.

**Mental model:** there is **one** write channel (`0x2A3E`) for commands *and*
upload data, and **three** notify channels — `0x2A3D` carries only the log-file
list, `0x2A3F` carries only binary download payload, and `0x2A40` is the universal
control/status bus that nearly every command answers on.

### 2.2 Device Information Service (DIS) — `0x180A` (standard)

Standard read-only service; the firmware publishes its identity here via Adafruit
`BLEDis`. Used for firmware version checks and variant selection.

| 16-bit UUID | Full 128-bit UUID | Characteristic | Read value (example) |
|---|---|---|---|
| `0x180A` | `0000180a-0000-1000-8000-00805f9b34fb` | DIS (service) | — |
| `0x2A29` | `00002a29-0000-1000-8000-00805f9b34fb` | Manufacturer Name | `DovesDataLogger` |
| `0x2A24` | `00002a24-0000-1000-8000-00805f9b34fb` | Model Number | `BirdsEye-<variant>` e.g. `BirdsEye-sense` |
| `0x2A26` | `00002a26-0000-1000-8000-00805f9b34fb` | Firmware Revision | `2.1.0` |

- **Variant** is derived from the model string: everything after the **last** `-`,
  lowercased — `BirdsEye-sense` → `sense`. If the model isn't `Name-variant`
  shaped, variant is `null`.
- DIS strings may be NUL-padded; strip trailing `\0` and whitespace.
- Reads are degrade-gracefully: a missing characteristic → `null`, not a fatal
  error. Only an absent **DIS service** is fatal for a version check.

---

## 3. Connection establishment

1. **Scan / select** by advertised service UUID `0x1820`. (Web Bluetooth:
   `filters: [{ services: [0x1820] }]`.)
2. **Request the DIS** as an additional accessible service (Web Bluetooth:
   `optionalServices: [0x180A]`) so the firmware version can be read on the same
   connection.
3. **Connect** the GATT server.
4. **Discover** the `0x1820` primary service and its four characteristics
   (`0x2A3D`, `0x2A3E`, `0x2A3F`, `0x2A40`).
5. **Settle:** wait ~500 ms after discovery before the first command (device
   stability).
6. **Subscribe** to the notify characteristic(s) a given protocol uses
   **before** writing the command that triggers them (see each protocol below).

> **No DFU service is requested.** Firmware updates ride the `0x1820` file service
> (see §10). Chrome's Web Bluetooth blocklist bans the Nordic legacy DFU service,
> so it's deliberately never in the connection's service list.

### 3.1 GATT serialization (important for native ports)

Web Bluetooth (and most GATT stacks) **serialize** GATT operations: a second
read/write/`startNotifications` issued while one is in flight throws "GATT
operation already in progress" (Chrome surfaces it as a `NetworkError`). Two
consequences for any client:

- **Never** issue concurrent GATT ops (e.g. `Promise.all` of two reads). Read
  characteristics **sequentially**.
- A read can transiently collide with another subsystem's in-flight command (e.g.
  reading DIS while a settings `SLIST` is mid-flight). The reference client retries
  busy errors ~10× at 200 ms (≈2 s window). A genuine "characteristic not found"
  is **not** transient — fail fast on it.

### 3.2 Disconnect

Just drop the GATT connection. Safe to call when already disconnected. Some flows
(settings reset, firmware apply) expect the device to reboot and the link to drop
on its own — treat that disconnect as expected.

---

## 4. Command summary

All commands are UTF-8 text **written to `0x2A3E`** (File Request). The reply
channel and terminator differ per command.

| Command (write → `0x2A3E`) | Reply channel | Success / terminator | Error |
|---|---|---|---|
| `LIST` | `0x2A3D` | `…END` (anchored at end) | (timeout) |
| `GET:<filename>` | `0x2A40` then `0x2A3F` | `SIZE:<n>` → data chunks → `DONE` | `ERROR` |
| `BATT` | `0x2A40` | `BATT:<pct>,<volt>` | (timeout) |
| `SLIST` | `0x2A40` | `SVAL:<k>=<v>` … → `SEND` | — |
| `SGET:<key>` | `0x2A40` | `SVAL:<key>=<value>` | `SERR:<reason>` |
| `SSET:<key>=<value>` | `0x2A40` | `SOK:<key>` | `SERR:<reason>` |
| `SRESET` | `0x2A40` | `SOK:RESET` (then device reboots) | `SERR:<reason>` |
| `TLIST` | `0x2A40` | `TFILE:<name>` … → `TEND` | — |
| `TGET:<name>` | `0x2A40` then `0x2A3F` | `SIZE:<n>` → data chunks → `DONE` | `TERR:<reason>` / `ERROR` |
| `TPUT:<name>` | `0x2A40` | `TREADY` → (client uploads) → `TDONE`* → `TOK` | `TERR:<reason>` |
| `TDEL:<name>` | `0x2A40` | `TOK` | `TERR:<reason>` |
| `FWBEGIN:<size>,<crc32>,<variant>` | `0x2A40` | `FWCRC:<crc32>` (echo) | `FWERR:<reason>` (`FWERR:VARIANT`) |
| `FWPUT:<size>` | `0x2A40` | `FWREADY` → (client uploads) → `FWDONE`* → `FWOK:<crc32>` | `FWERR:<reason>` |
| `FWAPPLY` | `0x2A40` | `FWSTAGE:<pct>` … → `FWAPPLIED` (or disconnect) | `FWERR:<reason>` |

\* `TDONE` / `FWDONE` are **client→device** terminators written to `0x2A3E` after
the client finishes streaming upload chunks (see §8.3, §10.3).

> The same `SIZE:/DONE/ERROR` download mechanism backs both `GET:` (logs) and
> `TGET:` (track files); track downloads additionally accept `TERR:` as the error
> form.

---

## 5. File list protocol (`LIST`)

Lists the **log files** stored on the device.

```
client → 0x2A3E : "LIST"
device → 0x2A3D : "<name>:<size>|<name>:<size>|…|END"      (chunked notifications)
```

- The list is a `|`-separated set of `name:size` pairs. `END` is sent as its own
  trailing field; it may arrive batched onto the last data chunk (`…|END`).
- **Terminator detection:** accumulate all chunks, then match `END` anchored at the
  **end of buffer** (regex `/\|?END\s*$/`). Anchoring avoids a false match inside a
  filename that begins with `END` (e.g. `ENDURANCE.dove`).
- **Idle fallback:** if no notification arrives for ~2 s but the buffer is
  non-empty, treat the list as complete. Hard timeout ~10 s with no data at all →
  error.
- **Parsing:** split on `|`, then each entry on the first `:` into `{name, size}`
  (`size` parsed as base-10 int). Skip empty entries.
- **Filtering:** the device's `SETTINGS.json` may appear in the list; clients
  exclude it from the *download* list (case-insensitive `SETTINGS.JSON`).

`size` is informational (used for progress %); the authoritative byte count comes
from `SIZE:` during the actual download.

---

## 6. File download protocol (`GET:`)

Streams one file's bytes from device to client.

```
client → 0x2A3E : "GET:<filename>"
device → 0x2A40 : "SIZE:<totalBytes>"          (once, up front)
device → 0x2A3F : <binary chunk> …             (many notifications)
device → 0x2A40 : "DONE"                        (terminator)
   — or —
device → 0x2A40 : "ERROR"                       (open/read failure)
```

Client algorithm:

1. Subscribe to **both** `0x2A3F` (data) and `0x2A40` (status) before writing
   `GET:`.
2. On `SIZE:<n>` → record expected total (drives progress %).
3. On each `0x2A3F` notification → append the raw bytes. **Copy** the buffer out of
   the event value; BLE stacks reuse the underlying `ArrayBuffer` between
   notifications.
4. On `DONE` → concatenate all chunks (final length == sum of received) and resolve.
5. On `ERROR` → fail ("error opening file on device").
6. **Timeout:** ~5 minutes (large logs), measured as no completion (not per-chunk).

Throughput note: bursts reach 125+ kB/s; the data handler must stay lean (push
chunk, bump a running counter — no per-notification `reduce`), and UI progress
should be throttled (e.g. rAF) off the hot path. Chunk size is the negotiated
ATT_MTU minus 3 (≈20 B at the BLE minimum, larger with MTU negotiation).

---

## 7. Battery protocol (`BATT`)

```
client → 0x2A3E : "BATT"
device → 0x2A40 : "BATT:<percent>,<voltage>"    e.g. "BATT:85,3.98"
```

- `percent` = integer 0–100; `voltage` = float volts.
- Subscribe to `0x2A40` first. The notification may contain multiple newline-
  separated lines — scan for the `BATT:` line. Ignore a line whose percent/voltage
  don't parse as numbers.
- Timeout ~5 s.

---

## 8. Settings protocol (`S*`)

All settings tokens are on `0x2A40`. Keys/values are text. Known keys, their types,
and validation live in `src/lib/deviceSettingsSchema.ts`; **unknown keys are
forward-compatible** — a client should display/round-trip any key the device sends,
not just the known set.

### 8.1 List all (`SLIST`)

```
client → 0x2A3E : "SLIST"
device → 0x2A40 : "SVAL:<key>=<value>"   (one per setting, possibly several per notification)
device → 0x2A40 : "SEND"                 (terminator)
```

Parse each `SVAL:` line by splitting on the **first** `=`. Build a `key → value`
map. Resolve on `SEND`. Reset a ~3 s idle timer per message; hard timeout ~10 s.

### 8.2 Get one (`SGET:<key>`)

```
client → 0x2A3E : "SGET:<key>"
device → 0x2A40 : "SVAL:<key>=<value>"   (match the requested key)
   — or —
device → 0x2A40 : "SERR:<reason>"        e.g. "SERR:NOT_FOUND"
```

Timeout ~5 s.

### 8.3 Set one (`SSET:<key>=<value>`)

```
client → 0x2A3E : "SSET:<key>=<value>"
device → 0x2A40 : "SOK:<key>"            (success; "SOK: <key>" with a space also accepted)
   — or —
device → 0x2A40 : "SERR:<reason>"        e.g. "SERR:WRITE_FAIL"
```

Timeout ~5 s.

### 8.4 Factory reset (`SRESET`)

```
client → 0x2A3E : "SRESET"
device → 0x2A40 : "SOK:RESET"            (then the device reboots)
```

After `SOK:RESET` the device reboots — the client should **disconnect immediately**
and expect the link to drop. Timeout ~10 s. Errors as `SERR:<reason>`.

### 8.5 Known settings (schema)

| Key | Type | Range / max | Meaning |
|---|---|---|---|
| `device_name` | string | ≤32 chars | Custom logger name |
| `bluetooth_name` | string | ≤30 chars | Advertised BLE name (visible during pairing) |
| `bluetooth_pin` | number | 0–9999 (4 digits) | Pairing PIN |
| `driver_name` | string | ≤30 chars | Written into the DOVEX session header |
| `lap_detection_distance` | number | 1–50 (m) | Start/finish crossing threshold |
| `waypoint_detection_distance` | number | 5–100 (m) | Waypoint/course detector proximity zone |
| `waypoint_speed` | number | 5–100 (MPH) | Minimum speed to arm lap/waypoint detection |
| `use_legacy_csv` | number | 0–1 | Save `.dove` (1) instead of `.dovex` (0) |

Unknown keys are treated as untyped strings with no validation.

---

## 9. Track-file protocol (`T*`)

Track files are JSON describing tracks/courses the logger uses for on-device lap
detection. All control tokens are on `0x2A40`; downloads reuse the `0x2A3F` data
channel.

### 9.1 List (`TLIST`)

```
client → 0x2A3E : "TLIST"
device → 0x2A40 : "TFILE:<name.json>"   (one per file)
device → 0x2A40 : "TEND"                 (terminator)
```

Idle timer ~3 s per message; hard timeout ~10 s.

### 9.2 Download (`TGET:<name>`)

Identical mechanics to §6 (`SIZE:` → `0x2A3F` chunks → `DONE`), but the error form
is `TERR:<reason>` (bare `ERROR` also accepted). Timeout ~60 s.

```
client → 0x2A3E : "TGET:<name.json>"
device → 0x2A40 : "SIZE:<n>"
device → 0x2A3F : <chunk> …
device → 0x2A40 : "DONE"   |  "TERR:<reason>"
```

### 9.3 Upload (`TPUT:<name>`)

```
client → 0x2A3E : "TPUT:<name.json>"
device → 0x2A40 : "TREADY"                       (device ready to receive)
client → 0x2A3E : <chunk> … (≤64 bytes each, ~10 ms apart)
client → 0x2A3E : "TDONE"                         (end-of-upload marker)
device → 0x2A40 : "TOK"   |  "TERR:<reason>"
```

- Upload chunks are written to the **same `0x2A3E`** request characteristic as
  commands; the device is in receive mode between `TREADY` and `TDONE`.
- **Chunk size: 64 bytes**, with a small (~10 ms) inter-chunk delay for device
  stability.
- After streaming, write the literal `TDONE` to signal completion; await `TOK`.
- Timeouts: ~10 s waiting for `TREADY`; ~10 s waiting for `TOK` after `TDONE`.

### 9.4 Delete (`TDEL:<name>`)

```
client → 0x2A3E : "TDEL:<name.json>"
device → 0x2A40 : "TOK"   |  "TERR:<reason>"
```

Timeout ~10 s.

> **Track JSON shape** (one course): a flat course object including `lengthFt`
> (the device uses lap distance for course detection). Conversion between app
> `Track`/`Course` and device JSON lives in `src/lib/deviceTrackSync.ts`
> (`buildTrackJsonForUpload`, `deviceCourseToAppCourse`, `appCourseToDeviceJson`);
> coordinate matching uses an epsilon of `0.0000005°`.

---

## 10. Firmware update protocol (`FW*`) — SD-staged OTA

The firmware image is **uploaded to the device's SD card** over the `0x1820` file
service, CRC-verified on-device, then installed by the firmware itself. This avoids
the Chrome-blocklisted Nordic DFU service entirely. Full design + firmware contract:
[`docs/plans/0002-firmware-sdcard-ota.md`](plans/0002-firmware-sdcard-ota.md).

**CRC is CRC-32/IEEE 802.3** (reflected poly `0xEDB88320`, init/xor `0xFFFFFFFF` —
the zlib/`crc32` variant), exchanged as an **8-char lowercase zero-padded hex
string**. Both ends must agree byte-for-byte. Reference: `src/lib/ble/firmwareCrc.ts`.

All `FW*` tokens are on `0x2A40`; commands and image chunks are written to `0x2A3E`.

The CRC is verified at **every** hop so neither the image nor the agreed checksum
can be silently corrupted:

```
0. [client] download appBin; assert crc32(image) == manifest appCrc32 (and appSize)
1. [client] that same crc32 is reused for the whole handshake
2. client → 0x2A3E : "FWBEGIN:<size>,<crc32>,<variant>"   announce + target variant
3. device → 0x2A40 : "FWCRC:<crc32>"                       device echoes received CRC
        client aborts unless echo == its own crc32         (control channel verified)
        device → "FWERR:VARIANT" if <variant> != its build (fail fast)
4. client → 0x2A3E : "FWPUT:<size>"  → device "FWREADY" → stream chunks → "FWDONE"
5. device computes crc32 of stored SD file
6. device → 0x2A40 : "FWOK:<crc32>"  (match) | "FWERR:CRC" (mismatch → abort)
7. client → 0x2A3E : "FWAPPLY"                              stage → flash → reset
8.         device resets into new firmware → BLE disconnect (treated as success)
9. [client] reconnect → read DIS firmware rev → confirm new version
```

### 10.1 Begin (`FWBEGIN`)

```
client → 0x2A3E : "FWBEGIN:<size>,<crc32hex>,<variant>"
device → 0x2A40 : "FWCRC:<crc32hex>"     (echo — must equal the client's CRC)
   — or —
device → 0x2A40 : "FWERR:<reason>"       ("FWERR:VARIANT" = wrong build)
```

- `<variant>` is the device's own DIS variant (e.g. `sense`); the device rejects a
  mismatched image **here**, before any upload.
- The client **aborts** unless the echoed CRC equals the locally computed CRC
  (proves the control channel carried the checksum intact). Timeout ~10 s.

### 10.2 Upload (`FWPUT`)

```
client → 0x2A3E : "FWPUT:<size>"
device → 0x2A40 : "FWREADY"
client → 0x2A3E : <chunk> …               (default 240 bytes/chunk, ~10 ms apart)
client → 0x2A3E : "FWDONE"
device → 0x2A40 : "FWOK:<crc32hex>"       (device's CRC of the stored file)
   — or —
device → 0x2A40 : "FWERR:<reason>"
```

- **Chunk size: 240 bytes** (fits a negotiated 247-byte ATT_MTU), ~10 ms apart.
  (Contrast with the 64-byte track upload — firmware upload assumes MTU
  negotiation.)
- The client accepts `FWOK` only if the device's stored-file CRC equals the
  expected CRC.
- **Watchdog, not total cap:** the upload arms a per-step timeout (~15 s) that is
  **reset on every chunk**, so a large image never times out — only a genuine stall
  does.

### 10.3 Apply (`FWAPPLY`)

```
client → 0x2A3E : "FWAPPLY"
device → 0x2A40 : "FWSTAGE:<pct>" …       (staging progress 0–100)
device → 0x2A40 : "FWAPPLIED"             (optional — may reset before sending it)
   — or the device simply disconnects as it reboots (also success)
   — or —
device → 0x2A40 : "FWERR:<reason>"
```

- A single-bank apply can reboot before flushing `FWAPPLIED`, so the client treats
  **either** `FWAPPLIED` **or** the GATT disconnect as success. Subscribe to the
  disconnect event before sending `FWAPPLY`.
- `FWSTAGE:<pct>` progress resets the apply watchdog (~60 s; staging/flashing is
  slow).
- After the device reboots, reconnect and re-read DIS (`0x2A26`) to confirm the new
  version.

### 10.4 Manifest & image source (online-only)

The image and its expected CRC come from an OTA **manifest** published on GitHub
Pages (permissive CORS, fetchable directly from the browser):

- Production: `https://theangryraven.github.io/DovesDataLogger/manifest.json`
- Beta channel (non-`main`/preview builds): `…/DovesDataLogger/beta/manifest.json`
- Override: `VITE_FIRMWARE_MANIFEST_URL` (any branch).

Each build entry is keyed `BirdsEye-<variant>` and carries `variant`, a raw `appBin`
URL, `appCrc32`, and `appSize` (preferred path — download the `.bin` directly and
verify against `appCrc32`/`appSize` as the first CRC link). A legacy `dfuZip`
(Nordic DFU zip) remains as a fallback for older manifests without `appBin`; the
client extracts the application `.bin` from it. Types/parsing:
`src/lib/ble/dfu/dfuTypes.ts`, `firmwareManifest.ts`, `dfuPackage.ts`.

---

## 11. Reference implementation map (`src/lib/ble/`)

The web client is split per-concern; the legacy barrel `bleDatalogger.ts` and the
new `ble/index.ts` re-export the public surface.

| File | Protocol(s) |
|---|---|
| `connection.ts` | Scan/connect/disconnect, characteristic discovery (§3) |
| `internal.ts` | UUID constants (`0x1820`, `0x2A3D`–`0x2A40`), debug log gate |
| `types.ts` | `BleConnection`, `FileInfo`, `DownloadProgress`, `BatteryInfo` |
| `fileTransfer.ts` | `LIST` + `GET:` (§5, §6) |
| `battery.ts` | `BATT` (§7) |
| `settings.ts` | `SLIST` / `SGET` / `SSET` / `SRESET` (§8) |
| `trackSync.ts` | `TLIST` / `TGET` / `TPUT` / `TDEL` (§9) |
| `firmwareCrc.ts` | CRC-32/IEEE (§10) |
| `firmwareUpload.ts` | `FWBEGIN` / `FWPUT` / `FWAPPLY` (§10) |
| `dfu/version.ts` | DIS read: firmware version/variant/manufacturer (§2.2) |
| `dfu/dfuTypes.ts`, `dfu/firmwareManifest.ts`, `dfu/dfuPackage.ts` | OTA manifest + image source (§10.4) |
| `format.ts` | Human-readable byte/speed/time formatters (UI only) |

App-architecture context (DeviceContext, drawer tabs, `LoggerConnection`
abstraction, the firmware-update UI/hook) lives in [`docs/ble.md`](ble.md). This
file is the **wire** spec; that one is the **app integration** guide.

---

## 12. Porting checklist (e.g. Tauri native shell)

For a non-Web-Bluetooth central (btleplug/`tauri-plugin-blec`, bleak, etc.):

1. **Use full 128-bit UUIDs** from §2 (16-bit shorthand is a Web-Bluetooth
   convenience).
2. **Scan** by service `0x1820`; connect; discover the four characteristics + DIS.
3. **Enable notifications** (subscribe to the CCCD) on `0x2A3D`, `0x2A3F`, `0x2A40`
   as each protocol needs — **before** writing the triggering command.
4. **Write commands** to `0x2A3E` as UTF-8 bytes. For uploads, write raw payload
   chunks to the *same* characteristic (64 B for `TPUT`, 240 B for `FWPUT`), then
   the text terminator (`TDONE` / `FWDONE`).
5. **Serialize GATT ops** — never overlap reads/writes/subscribes; add a small
   busy-retry for transient contention.
6. **Accumulate + split** notifications on `\n` (control) and anchor terminators at
   end-of-buffer (`END`); copy data-channel bytes immediately (buffer reuse).
7. **CRC-32/IEEE** for firmware, hex-encoded; mirror the §10 handshake exactly.
8. **Honor the timeouts** in §4–§10; use a per-chunk watchdog (not a total cap) for
   large transfers.
9. **Expect reboots** on `SRESET` and `FWAPPLY` — treat the disconnect as expected.
</content>
