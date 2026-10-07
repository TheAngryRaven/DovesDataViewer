# Remote transfer — the app side of the logger's PIN handshake

> Status: **implemented, pending a hardware check** (viewer side). Firmware is
> DovesDataLogger plan 0019 (PR #168, BETA); the native shell's twin lands in
> LapWing. The wire spec is `docs/ble-protocol.md` §3.3.

## Problem

Downloading from the Fledgling meant pressing Transfer → Bluetooth on the
logger, then Connect in the app. The logger is often bolted to a kart in a
trailer. The ask: let the app start a transfer while the logger sits on its main
menu, without making that an open door for any phone in the pits, and without
ever taking the radio from the Insta360 auto-record.

## What the firmware does (logger plan 0019, summarised)

- On the main menu, with `remote_transfer` = `on`, the logger advertises the
  usual `0x1820` service in a **locked** mode. Only `AUTH?`, `AUTH:<answer>` and
  `BATT` work until the app proves it knows the 4-digit PIN.
- Proof = first 16 bytes of `HMAC-SHA256(PIN, "BEAUTH1|" + nonceHex)`, hex. The
  PIN never crosses the air on a remote start.
- A correct answer turns the logger into the transfer page ("Remote Transfer").
- 5 wrong answers → 60 s lockout, doubling to 15 min. 20 s to authenticate.
- The camera always wins: `AUTH:CAMERA` and the link drops.
- A **local** start is open, and `PINGET` hands over the PIN there.
- Transfer → PIN on the logger shows it (hold Select) and can roll a new one.

## Decisions (app side)

1. **One place runs the handshake: `DeviceContext.connect`.** Every web BLE
   surface (Device tab, the Fledgling download flow) connects through it, so
   `authenticateLogger()` runs right after `connectToDevice()` and nothing
   downstream knows auth exists. A failure disconnects, toasts the reason (not
   for a user cancel) and returns null — which the download flow already reads
   as "close".
2. **Learn the PIN instead of asking for it.** On `AUTH:OPEN` (local start) the
   app sends `PINGET` and stores the answer. The first remote start after any
   local one needs no typing. Only a logger the app has never seen locally
   prompts.
3. **Stored PIN first, silently; a rejected one is forgotten.** A PIN changed on
   the logger would otherwise burn a try on every connect. The prompt then shows
   the tries left.
4. **Storage is per device, local, never synced.** `localStorage`, keyed by
   Web Bluetooth `device.id` (stable per origin while the permission lasts) with
   the advertised name as a fallback when the browser issues a fresh id. Every
   access is guarded; a private window just means asking again. Cloud sync was
   rejected: it would move a device secret into a server for a convenience the
   `PINGET` learning already provides.
5. **2 s of silence to `AUTH?` = pre-0019 firmware.** It doesn't know the verb
   and says nothing; treating that as open keeps every older logger working.
   It costs 2 s on a legacy connect, once.
6. **The Device tab still shows the PIN.** New firmware omits it from `SLIST`;
   the tab injects the stored copy (which the handshake just fetched or proved,
   so it is current) and re-stores it on a successful `SSET`. The schema now
   requires exactly four digits (`0042` is a valid PIN) and adds the
   `remote_transfer` on/off setting.
7. **Native (LapWing) is separate.** The Tauri shell talks BLE in Rust; it gets
   its own implementation of the same handshake against the same golden vectors.
   This plan's code is web-only.

## Files

- `src/lib/ble/auth.ts` — `computeAuthAnswer` (WebCrypto), `parseAuthReply`,
  `sendAuthCommand`, `authenticateLogger`, `LoggerAuthError`.
- `src/lib/ble/pinStore.ts` — the per-logger store.
- `src/components/LoggerPinDialog.tsx` — the prompt, mounted by `DeviceProvider`.
- `src/contexts/DeviceContext.tsx` — runs the handshake on connect.
- `src/components/drawer/DeviceSettingsTab.tsx`, `src/lib/deviceSettingsSchema.ts`.
- Tests: `src/lib/ble/auth.test.ts` (golden vectors, every reply, the flow),
  `src/lib/deviceSettingsSchema.test.ts`.

## Known limits

- **Unencrypted link.** A sniffer that captures a nonce + answer can brute-force
  10 000 PINs offline. The gate stops a casual phone, not a determined attacker
  with a sniffer; changing the PIN is the remedy. Documented in the wire spec.
- **The 20 s squat limit includes the prompt.** A user who takes longer to read
  the PIN off the logger gets "stopped waiting" and connects again (the logger
  now shows nothing new to type, the second try is quick).
- **Hardware check outstanding:** remote start from the menu, wrong-PIN lockout,
  `AUTH:CAMERA` with a paired X4, and a legacy logger connecting after 2 s.
