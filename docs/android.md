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
Lovable-secret parallel `HTT_IS_NATIVE=true`).

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
- **External links** open in the system browser via the native bridge
  (`openExternal` / `interceptExternal` in `platform.ts`), not the app WebView.

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
