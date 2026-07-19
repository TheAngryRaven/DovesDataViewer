# Android / Tauri shell

The same frontend bundle serves the web app **and** a native Android app built
with [Tauri](https://tauri.app) (a separate repo wraps this build). This doc
covers what lives **in this repo** to support that, plus the Google Play
artifacts (Data Safety form, permission set) the Tauri repo's manifest must
match. The Tauri repo owns the Android manifest, permissions, CSP allowlist,
signing, and the native bridge implementation.

## How web-vs-native is decided

`src/lib/platform.ts` is the single source of truth:

- `isNativeBuild()` — the build flag `VITE_IS_NATIVE === "true"` (set by the
  Tauri build; defaults `"false"`, wired in `vite.config.ts` like the other
  flags). Deterministic and available at import time.
- `isTauri()` — runtime check for Tauri's injected globals (`__TAURI_INTERNALS__`
  v2 / `__TAURI__` v1).
- `isNativeApp()` = `isNativeBuild() || isTauri()` — **the** predicate everything
  branches on. The flag is primary because some decisions (service-worker
  registration in `main.tsx`) run before Tauri injects its globals.

To build the native variant: invoke Vite with `VITE_IS_NATIVE=true` (or the
build-secret parallel `HTT_IS_NATIVE=true`).

## What changes on native

- **No service worker.** `main.tsx` routes native through the existing
  `cleanupPreviewServiceWorkers()` path (the shell serves its own packaged
  assets; a stray SW would only fight it). A Tauri WebView is a *top-level*
  window, so the prior iframe/preview gate didn't catch it.
- **No in-app purchases.** Paid cloud-storage plans are bought and managed on the
  web only (Google Play forbids non-Play billing for in-app digital goods). Cloud
  **sync stays available** — a user who subscribed on the web keeps their tier in
  the app. Gating: `pricingCta(... native)` returns no CTA (`src/lib/billing.ts`),
  paid cards/CTAs are hidden in `PricingCards.tsx`, the plan picker is hidden in
  `Register.tsx`/`PlanCheckout.tsx`, `PendingCheckoutRedirect` is disabled, the
  Stripe portal buttons are hidden in `StoragePanel.tsx` (the plan still shows,
  read-only), and `createCheckout`/`createPortal` throw as a backstop
  (`billingClient.ts`).
- **External links** open in the system browser, not the app WebView, via
  `openExternal` / `interceptExternal` in `platform.ts`. Resolution order under
  native: the `__HTT_NATIVE__` bridge if the shell wired it; otherwise Tauri's
  **opener plugin** (`@tauri-apps/plugin-opener`, dynamically imported so it stays
  off the web bundle); otherwise a new tab. **For the opener-plugin path to work
  the Tauri shell must register `tauri-plugin-opener`** (+ an `opener:default`
  capability) — without it (and without the bridge) external links fall back to a
  new tab, which a WebView opens in-app.

## Native bridge contract

The Tauri repo wires a single global the frontend calls:

```ts
window.__HTT_NATIVE__ = {
  // Open a URL in the device's default browser, outside the app WebView.
  openExternal(url: string): void | Promise<void>;
};
```

If the bridge is absent, `openExternal` falls back to `window.open(..., "_blank")`.
The TypeScript contract is `NativeBridge` in `src/lib/platform.ts`.

## MyChron Wi-Fi download (native-only)

Browsers can't open raw TCP sockets, so pulling a session off an **AiM MyChron**
over Wi-Fi is native-only. The MyChron tile in the logger picker
(`LoggerPicker.tsx`) starts the real flow only when `isNativeApp()`; on the web it
keeps its explanatory dialog. The flow lives in `MyChronDownload.tsx` (lazy) and
drives the Tauri backend through app-defined IPC commands (no capabilities to
configure — allowed by `core:default`). The client is
`src/lib/loggers/mychron/ipc.ts`, which reaches Tauri via a **dynamic**
`import("@tauri-apps/api/core")` so `@tauri-apps/api` code-splits into the lazy
MyChron chunk and never enters the web/eager bundle.

IPC contract (args camelCase; all reject with a plain string whose prefix encodes
the category — `device unreachable:`, `device hung:`, `protocol error:`,
`unsupported:`, `Wi-Fi join was declined…`, `no logger connected …`):

| Command | Args | Resolves to |
|---------|------|-------------|
| `logger_connect` | `{ kind:"mychron", host?, wifi? }` | device info |
| `logger_list_files` | – | file entries |
| `logger_download_file` | `{ name, onProgress: Channel }` | `ArrayBuffer` (already-inflated XRK) |
| `logger_disconnect` | – | `void` |

On **Android** the flow passes `wifi: { ssidPrefix }`; the OS shows a system Wi-Fi
picker that **only lists networks whose SSID starts with that prefix** (the backend
joins + binds the process to the AP via `WifiNetworkSpecifier`, a case-sensitive
`PatternMatcher` prefix), and the UI shows a "waiting for you to pick your MyChron…"
state while it's up. The prefix is **user-configurable** — Settings → MyChron
(`AppSettings.mychronSsidPrefix`, read in `MyChronDownload.tsx`), defaulting to
`MYCHRON_SSID_PREFIX` (`ipc.ts`); the field is native-gated in `SettingsModal.tsx`.
On **desktop** the `wifi` hint is omitted (the user joins the AP via the OS). The
default prefix value and whether the AP is open or WPA2 are **open hardware items**
— confirm from a real device. The download returns
decompressed XRK bytes, which go straight into the existing async importer
(`parseDatalogFile`, wasm worker) named `<name>.xrk`. The flow **owns its
connection** and calls `logger_disconnect` on every exit (close/cancel/error/
unmount). MyChron's `LoggerConnection.supportsDeviceDetails` is `false` — no in-app
settings/tracks/firmware tab.

## Error-prefix handling (all native logger flows)

Every `logger_*` rejection string is classified by
`src/lib/loggers/errors.ts` (`classifyLoggerError`) into a typed category, and the
download flows render a translated, actionable headline (`logger:errors.*`) with
the matching Retry / Rescan / Reconnect button via the shared `ErrorPanel`
(`DownloadPanels.tsx`); the raw backend string is preserved behind a collapsed
"technical details" disclosure. Android permission denials arrive under
`device unreachable:` — the remainder is sniffed for permission wording and maps
to a dedicated "Bluetooth permission needed" message. `unsupported:` renders as
an informational "not available" panel (never an error toast), and
`isMissingCommandError` detects an older shell missing a command entirely.

## DovesLogger / Fledgling BLE download + firmware (native)

The same Fledgling hardware the web app reaches over Web Bluetooth is served
natively over Tauri BLE IPC: `DovesloggerDownload.tsx` (lazy) drives
`logger_scan({ kind:"doveslogger" })` → in-app device picker (BLE has no OS
picker; the backend matches the advertised `0x1820` service, so renamed devices
still appear) → `logger_connect({ kind:"doveslogger", host })` → list → download.
Downloads are the raw device file bytes (`.dove`/`.dovex`/`.csv`) fed to
`parseDatalogFile` unchanged. First scan/connect on Android may pop the runtime
Bluetooth permission dialog — a denial rejects under `device unreachable:` and
renders the permission message + Rescan. The flow owns its connection and
disconnects on every exit.

**Firmware update (native):** a Firmware button on the connected file-list
screen runs check → confirm → download → upload via
`logger_update_firmware({ image, onProgress: Channel })`
(`useNativeFirmwareUpdate` + `NativeFirmwarePanel`). It reuses the web OTA's
transport-agnostic `lib/ble/dfu/` layer end-to-end (manifest, variant pick,
version evaluate, CRC-verified download via `acquireFirmwareImage`); installed
version/variant come from the connect handshake's `LoggerDeviceInfo.fields`
(`doveslogger/firmwareInfo.ts` probes candidate keys and honors an optional
`cap.fw_update` capability flag — **exact field names are an open item with the
LapWing side**). When the device didn't report a variant, the user confirms
sense/nonsense explicitly. After upload the device **flashes and reboots — the
BLE drop is success**; the UI says "device is restarting" and lands back at the
scan screen. If the shell lacks the command (`unsupported:` / unknown command),
the flow shows "not available in this app version" and hides the button for the
session — no build flag needed. Settings/tracks/battery remain web-only
(`supportsDeviceDetails` stays `false`). Open items: the final command
name/signature and whether the image should ride a raw-body
`tauri::ipc::Request` instead of a JSON-serialized `Uint8Array` (~3-4× inflation
for a ~700 KB image) — the JS wrapper's signature is stable either way.

## Alfano 6 Bluetooth-serial download (native, Android-only)

Alfano talks Classic Bluetooth SPP, which neither the web nor (currently)
desktop shells can reach — the backend is Android-only and still TBD.
`AlfanoDownload.tsx` (lazy) mirrors the DovesLogger flow over
`logger_scan({ kind:"alfano" })` / `logger_connect({ kind:"alfano", host })`.
Per the contract: the scan returns **already-paired (bonded) devices only** (no
in-app discovery/pairing — the empty state should point at Android Bluetooth
settings), `rssi` is always absent, `logger_list_files` returns sessions newest →
oldest with hex-id `name`s (use `date`/`meta` for display), and desktop rejects
with `unsupported:`, which renders as the informational "not available on this
device" panel. The final download file format is still being decided on the
LapWing side (raw Alfano records today; the plan is a format DDV already
imports), so the import step stays pluggable behind `parseDatalogFile`.

## Account deletion (Google Play requirement)

Play requires a publicly reachable account-deletion URL in addition to the in-app
flow. This repo serves `/delete-account` (`src/pages/DeleteAccount.tsx`), mounted
**un-gated** in `App.tsx` so the URL resolves on every build. It signs the user in
(the deletion edge function derives the account from the session), then reuses the
emailed-code flow in `src/plugins/cloud-sync/accountDeletion.ts`. List
`https://lapwingdata.com/delete-account` in the Play Console as the deletion URL.

The in-app path remains **Profile → Data & privacy** (`DataPrivacyPanel.tsx`).

## Google Play Data Safety form

Mirror `src/pages/Privacy.tsx`. Summary of what the hosted service collects when a
user opts into cloud features (the offline app collects nothing off-device):

| Data type | Collected? | Purpose | Notes |
|-----------|-----------|---------|-------|
| Email address | Yes (account) | Account management | Required only to create an account |
| Name (display name) | Yes (account) | Account/app functionality | User-chosen or auto-generated |
| Precise location | Yes, only if the user syncs a session | App functionality | GPS traces inside telemetry logs the user chooses to sync; **foreground-only** capture |
| App activity / other content | Yes (account) | App functionality (sync) | Garage data, notes, setups, lap snapshots |
| Payment info | No (not collected by us) | — | Stripe handles card data on the **web**; no purchases in the Android app |

- **Encrypted in transit:** yes.
- **User can request deletion:** yes — in-app and at `/delete-account`.
- **Data shared with third parties / advertisers:** no. Sub-processors (Supabase,
  Stripe [web only], optional Google sign-in, Cloudflare Turnstile, the AI
  provider) process data on our behalf; nothing is sold or used for ads.

## Android permissions (declared in the Tauri repo manifest)

| Permission | Why |
|-----------|-----|
| `INTERNET` | Optional online features: cloud sync, weather, map/satellite tiles, firmware OTA |
| `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` | GPS lap timing / phone-as-datalogger and current-location convenience |
| `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` | Connect to a Dove's Data Logger over BLE (download laps, settings, firmware OTA) |
| `WAKE_LOCK` | Keep the screen awake during a recording session (`src/lib/wakeLock.ts`) |

**Location is foreground-only** — no `ACCESS_BACKGROUND_LOCATION`, no foreground
service. GPS is captured only while the app is open and actively timing/logging,
which keeps the Play review simple (no background-location declaration). If
background logging is ever added, it requires `ACCESS_BACKGROUND_LOCATION`, a
persistent foreground-service notification, and extra Play Console justification.

No camera/microphone permission: video export reuses files the user imports; audio
is read from the source video, never the mic.
