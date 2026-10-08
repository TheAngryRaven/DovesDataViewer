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
- The camera always wins: `AUTH:CAMERA` and the link drops. A remote session
  also ends with `AUTH:ENGINE` when the engine starts and `AUTH:IDLE` after
  10 min without transfer commands. Leaving the main menu drops a locked link.
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
   the logger would otherwise burn a try on every connect. "Rejected" is any
   verdict but OK — `FAIL`, and `LOCKED` (what the 5th miss returns). The prompt
   then shows the tries left. A Device-tab settings reset keeps it: the
   firmware's `SRESET` preserves a valid `bluetooth_pin` (it used to roll a new
   one, which review M3 flagged; the logger side fixed it there).
4. **Storage is per device, local, never synced.** `localStorage`, keyed by
   Web Bluetooth `device.id` only (stable per origin while the permission
   lasts). The first cut fell back to the advertised name when the browser
   issued a fresh id; review dropped it — default names come from a 1-in-1000
   space, so logger B's PIN could be tried on logger A and burn one of A's
   tries. Old name-keyed entries are never read and are pruned on the next
   write. Every access is guarded; a private window just means asking again.
   Cloud sync was rejected: it would move a device secret into a server for a
   convenience the `PINGET` learning already provides.
5. **2 s of silence to `AUTH?`, confirmed by a probe = pre-0019 firmware.** It
   doesn't know the verb and says nothing. Silence alone was too trusting (a
   slow reply read as legacy, and every later command then got
   `AUTH:REQUIRED`), so the app follows up with `SGET:bluetooth_name` and keeps
   listening: old firmware answers it, a locked logger answers `AUTH:REQUIRED`,
   and a late nonce still counts. The ~2 s is paid on every legacy connect, not
   once.
6. **The Device tab still shows the PIN.** New firmware omits it from `SLIST`;
   the tab injects the stored copy (which the handshake just fetched or proved,
   so it is current) and re-stores it on a successful `SSET`. The schema now
   requires exactly four digits (`0042` is a valid PIN) and adds the
   `remote_transfer` on/off setting.
7. **Native (LapWing) is separate.** The Tauri shell talks BLE in Rust; it gets
   its own implementation of the same handshake against the same golden vectors.
   This plan's code is web-only.

8. **The handshake owns the link until it hands it over.** One queue of status
   lines per connection; each step accepts only the replies it expects, and the
   queue is emptied before every write, so a stale or interleaved line is never
   an answer. The GATT drop and the logger's session-ending notices
   (`AUTH:TIMEOUT|CAMERA|ENGINE|IDLE`) are watched throughout, the PIN prompt
   included. `AUTH:BUSY` is retried once (the firmware also sends it when it
   can't read its PIN, without consuming the nonce); `AUTH:NO_NONCE` fetches a
   fresh nonce at most 3 times. Any other failure (GATT, write, WebCrypto) is a
   translated toast, never just a console line.
9. **Reading the PIN costs the link; the app reconnects.** Transfer → PIN on the
   logger leaves the main menu, which drops a locked link, and a slow typist
   hits the 20 s squat limit. Either way the prompt stays open (its copy says to
   return the logger to the main menu first); on submit the handshake reopens
   the same `BluetoothDevice` without the picker (`reconnectDevice`) and reruns
   with the typed PIN, storing it on success. Capped at 2 reconnects. A camera,
   engine or idle notice closes the prompt with a toast instead — reconnecting
   can't help there.
10. **Notices after the handshake are surfaced too.** `watchLinkEndNotices`
   toasts `AUTH:CAMERA` / `ENGINE` / `IDLE` on a connected logger, before the
   disconnect tears the Device tab or download dialog down.
11. **Off the landing payload.** `DeviceContext` dynamic-imports `lib/ble/auth`
   and lazy-loads `LoggerPinDialog` on the first connect. Unmounting
   `DeviceProvider` mid-prompt settles the prompt so the half-open link is
   disconnected rather than leaked.

## Files

- `src/lib/ble/auth.ts` — `computeAuthAnswer` (WebCrypto), `parseAuthReply`,
  `parseLinkEndNotice`, the line-queue `AuthChannel`, `authenticateLogger`,
  `watchLinkEndNotices`, `LoggerAuthError`.
- `src/lib/ble/pinStore.ts` — the per-logger store.
- `src/lib/ble/connection.ts` — `reconnectDevice` (same device, no picker).
- `src/components/LoggerPinDialog.tsx` — the prompt, lazy-mounted by `DeviceProvider`.
- `src/contexts/DeviceContext.tsx` — runs the handshake on connect.
- `src/components/drawer/DeviceSettingsTab.tsx`, `src/lib/deviceSettingsSchema.ts`.
- Tests: `src/lib/ble/auth.test.ts` (golden vectors, every reply, legacy probe,
  busy/no-nonce/timeout, notices and drops mid-prompt, reconnect),
  `src/lib/ble/pinStore.test.ts`, `src/lib/deviceSettingsSchema.test.ts`.

## Known limits

- **Unencrypted link.** A sniffer that captures a nonce + answer can brute-force
  10 000 PINs offline. The gate stops a casual phone, not a determined attacker
  with a sniffer; changing the PIN is the remedy. Documented in the wire spec.
- **The reconnect needs the logger back on its main menu.** If the user submits
  while the logger is still on the PIN page, `gatt.connect()` fails and the app
  says to return it to the menu and connect again.
- **Hardware check outstanding:** remote start from the menu, wrong-PIN lockout,
  `AUTH:CAMERA` with a paired X4, a legacy logger connecting after the probe,
  `AUTH:ENGINE` on an engine start, and the read-the-PIN-then-reconnect path (Chrome's `gatt.connect()` on a
  device that re-advertises).

## Review follow-up (PR #454)

H1 (prompt on a dead link, typed PIN lost), M1 (non-auth errors only logged),
M2 (slow reply read as legacy), L1–L6 and the nits are addressed by decisions
3–5 and 8–11 above. M3 (stale PIN after a settings reset) was fixed in the
firmware instead: `SRESET` now keeps the PIN, so the app keeps its copy.
