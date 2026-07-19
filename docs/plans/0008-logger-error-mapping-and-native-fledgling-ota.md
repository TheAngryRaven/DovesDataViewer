# Plan 0008 — Logger error mapping + native Fledgling firmware OTA

## Goal / problem

Getting the native (LapWing/Tauri) app to a stable device-wiring state. An
audit of the native logger flows (MyChron Wi-Fi, DovesLogger BLE, Alfano
Bluetooth-serial skeleton) found the download plumbing already complete —
`src/lib/loggers/{native,mychron,doveslogger,alfano}` + the four Download
components, all gated on `isNativeApp()`, all disconnect-on-exit, all feeding
`parseDatalogFile`. Two real gaps remained:

1. **The error-prefix contract was documented but never consumed.** The backend
   rejects with prefix-coded strings (`device unreachable:`, `device hung:`,
   `protocol error:`, `unsupported:`, `Wi-Fi join was declined`, `no logger
   connected`), the IPC layer passes them through unwrapped (tested) — and every
   flow rendered the raw string verbatim. No permission guidance, no
   Retry/Rescan/Reconnect distinction, no translation.
2. **No native firmware path.** Fledgling OTA existed only on the web build
   (Web Bluetooth, SD-staged `0x1820` protocol). The native shell had no
   `logger_update_firmware` wiring and no update UI; `supportsDeviceDetails:
   false` hides the whole web Device tab there by design.

Also: the web `DataloggerDownload.tsx` + shared `DownloadPanels.tsx` still had
hard-coded English, and `docs/android.md` documented only MyChron.

## Approach & key decisions

### Error classification (`src/lib/loggers/errors.ts`)

Pure, transport-free module: `classifyLoggerError(unknown) →
{ category, detail }` (prefix match, case-insensitive; also maps web
`NotAllowedError`/`SecurityError` DOMExceptions to `permission`),
`recoveryActionFor(category, stage) → retry|rescan|reconnect|none`,
`loggerErrorKey(category)` (typed literal union so the typed `t()` accepts it),
and `isMissingCommandError` (Tauri unknown-command sniffing; never matches a
prefixed rejection — a prefix means the command ran).

Decisions:
- **Permission denials ride `device unreachable:`** (backend behavior) — the
  remainder is sniffed with `/permission|denied|not allowed|bluetooth_(scan|connect)|nearby/i`.
  Verify the exact Rust wording when the backend is in hand.
- **Action mapping lives in lib** (unit-tested table), the components only wire
  handlers: failed scan/connect → rescan (device list is stale), failed
  download → retry the same file while the link is alive, `wifi-declined` →
  reconnect (re-drives the Android OS Wi-Fi picker), `hung` → reconnect,
  `unsupported` → none.
- **Raw string never headlines.** Shared `ErrorPanel` (`DownloadPanels.tsx`)
  renders the translated `logger:errors.*` message + action button, with the
  raw message in a collapsed "technical details" `<details>`. Alfano's desktop
  `unsupported:` renders as an informational not-available panel instead.
- `savedHint` is only shown when the auto-save actually succeeded (previously
  claimed unconditionally).

### Native firmware update

- **UI lives inside `DovesloggerDownload`** (a Firmware button on the connected
  file-list state → `firmware` state → `NativeFirmwarePanel`), NOT behind
  `supportsDeviceDetails` — flipping that would drag the Web-Bluetooth-bound
  `DeviceSettingsTab` (settings/tracks/battery, which stay web-only) into
  native. Everything stays in the already-lazy chunk; `@tauri-apps/api` and
  `lib/ble` GATT code stay off the web/eager graph (the native side imports
  `@/lib/ble/dfu` directly, never the `@/lib/ble` barrel).
- **Shared acquisition step:** `dfu/firmwareImage.ts` `acquireFirmwareImage`
  (download `appBin`/unzip `dfuZip` → `crc32Hex` → `assertImageMatchesBuild`)
  extracted from `useFirmwareUpdate`; both the web hook and
  `useNativeFirmwareUpdate` call it. The rest of the manifest layer
  (`fetchFirmwareManifest`, `pickBuildForVariant`, `evaluateFirmwareUpdate`,
  `isPreviewBuild()` force) is reused as-is.
- **Device identity:** `doveslogger/firmwareInfo.ts` derives version/model/
  variant from `LoggerDeviceInfo.fields` by probing candidate keys (`hw.fw`,
  `hw.firmware`, `hw.version`, `firmware`, `version`; `hw.model`, `model`,
  top-level `model`) through the existing pure `parseVariantFromModel`.
  Degradation ladder: version+variant → normal evaluate; variant only →
  forced "install latest vX" confirm; neither → explicit variant pick
  (variants listed from the manifest, no hardcoding).
- **Availability = runtime detection, no build flag.** An `unsupported:` or
  unknown-command rejection renders "not available in this app version" and
  latches a module-level session flag that hides the button. The backend can
  later pre-gate via a `cap.fw_update` field in `logger_device_info.fields`
  (`firmwareUpdateCapability` already honors it).
- **Reboot-drop = success.** Contract says the invoke resolves before the
  reboot; defensively, a rejection classifying `unreachable`/`hung` *after*
  progress reached `received >= total` is treated as success. On Done the host
  disconnects (best-effort) and re-enters `handleScan()` — user lands on the
  scan screen to reconnect to the new firmware.

### i18n

New `logger` namespace subtrees: `errors.*`, `progress.*` (the previously
hard-coded panel labels), `fledgling.flow.*` (web flow migration),
`doveslogger.firmware.*`; identical copy reuses `drawer:firmware.*`
(before-start checklist, phase labels, Done). No `ANTHROPIC_API_KEY` in the
work environment, so the six locales were hand-seeded (same stop-gap as the
profiles/datalogger strings, commit `6356bf4`) — a later `bun run i18n:seed`
will treat them as existing translations.

## What landed

- `src/lib/loggers/errors.ts` + tests; `ErrorPanel` in
  `src/components/loggers/DownloadPanels.tsx` (all panel strings now
  caller-translated); all four Download flows adopt classified errors.
- `src/lib/ble/dfu/firmwareImage.ts` (+ tests, exported from `dfu/index.ts`);
  `useFirmwareUpdate` refactored onto it (no behavior change).
- `loggerUpdateFirmware` in `src/lib/loggers/doveslogger/ipc.ts` (+ tests);
  `src/lib/loggers/doveslogger/firmwareInfo.ts` (+ tests).
- `src/hooks/useNativeFirmwareUpdate.ts`,
  `src/components/loggers/NativeFirmwarePanel.tsx`, firmware state in
  `DovesloggerDownload.tsx`.
- Docs: `docs/android.md` (error-prefix handling, DovesLogger native BLE +
  firmware, Alfano sections), `docs/ble.md` (native OTA pointer), CLAUDE.md
  map line, CHANGELOG under `[3.1.0] - unreleased`.

## Open items (coordinate with the LapWing repo)

- **`logger_update_firmware` final name/signature** — built against
  `invoke("logger_update_firmware", { image: Uint8Array, onProgress: Channel<DownloadProgress> })`,
  resolving `void` *before* the reboot. A `Uint8Array` inside the args object
  JSON-serializes (~3-4× inflation for a ~700 KB image); if that's too slow,
  switch the backend to a raw-body `tauri::ipc::Request` with the channel
  passed separately — the JS wrapper's signature stays stable either way.
- **`LoggerDeviceInfo.fields` key names** for firmware version/model (+ the
  optional `cap.fw_update` capability flag) — `firmwareInfo.ts` probes
  candidates; align and prune once fixed.
- **Exact Tauri unknown-command rejection text** — `isMissingCommandError` is
  deliberately permissive and unit-tested; tune once observed on-device.
- **Backend permission-denial wording** under `device unreachable:` — verify
  the sniff regex against the Rust source.
- **Real MyChron SSID prefix + AP auth** (open/WPA2) — still unconfirmed
  hardware items (pre-existing, `MYCHRON_SSID_PREFIX`).
- **Alfano**: Rust backend TBD; final download file format (raw records today,
  plan is a DDV-importable format); bonded-only empty-state copy should point
  at Android Bluetooth settings once the backend exists.
