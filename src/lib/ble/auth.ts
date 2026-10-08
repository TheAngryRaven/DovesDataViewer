/// <reference types="web-bluetooth" />

import type { BleConnection } from "./types";
import { bleLog } from "./internal";
import { forgetLoggerPin, loadLoggerPin, saveLoggerPin } from "./pinStore";

/**
 * Remote-transfer PIN handshake (plan 0031; firmware side is the logger's
 * plan 0019).
 *
 * A logger sitting on its main menu advertises a LOCKED transfer service: it
 * answers only `AUTH?`, `AUTH:<answer>` and `BATT` until the app proves it
 * knows the logger's 4-digit PIN. The proof is an HMAC over a fresh nonce, so
 * the PIN itself never crosses the air on a remote start:
 *
 *   app → `AUTH?`                     logger → `AUTH:NONCE:<32 hex>`
 *   app → `AUTH:<32 hex answer>`      logger → `AUTH:OK` | `AUTH:FAIL:<tries>`
 *                                                | `AUTH:LOCKED:<seconds>`
 *
 * answer = first 16 bytes of HMAC-SHA256(key = PIN ascii,
 *                                         msg = "BEAUTH1|" + nonceHex), hex.
 *
 * A transfer started ON the logger (Transfer → Bluetooth) is OPEN: `AUTH?`
 * answers `AUTH:OPEN`, and `PINGET` hands out the PIN — which is how the app
 * learns it without anyone typing it. Firmware older than 0019 doesn't know
 * `AUTH?` and says nothing, so silence within `LEGACY_TIMEOUT_MS` means
 * "nothing to prove".
 */

/** How long to wait for an `AUTH?` reply before treating the logger as pre-PIN firmware. */
export const LEGACY_TIMEOUT_MS = 2000;
/** Reply wait for every other step (the answer check reads the card). */
const REPLY_TIMEOUT_MS = 5000;
/** Domain-separation prefix, byte-identical to the firmware's `remote_auth`. */
const AUTH_DOMAIN = "BEAUTH1|";
/** The answer is the HMAC truncated to this many bytes (32 hex chars). */
const ANSWER_BYTES = 16;

/** A 4-digit PIN, exactly as the firmware's `remote_auth::isValidPin`. */
export function isValidPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}

/** The handshake answer for `pin` against the logger's `nonceHex`. */
export async function computeAuthAnswer(pin: string, nonceHex: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(AUTH_DOMAIN + nonceHex)));
  return Array.from(mac.subarray(0, ANSWER_BYTES), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One parsed `AUTH:` / `PIN:` status line. */
export type AuthReply =
  | { kind: "open" }
  | { kind: "ok" }
  | { kind: "nonce"; nonce: string }
  | { kind: "fail"; triesLeft: number }
  | { kind: "locked"; seconds: number }
  | { kind: "noNonce" }
  | { kind: "busy" }
  | { kind: "required" }
  | { kind: "camera" }
  | { kind: "timeout" }
  | { kind: "pin"; pin: string };

/** Parse a status line, or null when it isn't part of the handshake. */
export function parseAuthReply(line: string): AuthReply | null {
  const l = line.trim();
  if (l.startsWith("PIN:")) {
    const pin = l.substring(4);
    return isValidPin(pin) ? { kind: "pin", pin } : null;
  }
  if (!l.startsWith("AUTH:")) return null;
  const body = l.substring(5);
  switch (body) {
    case "OPEN": return { kind: "open" };
    case "OK": return { kind: "ok" };
    case "NO_NONCE": return { kind: "noNonce" };
    case "BUSY": return { kind: "busy" };
    case "REQUIRED": return { kind: "required" };
    case "CAMERA": return { kind: "camera" };
    case "TIMEOUT": return { kind: "timeout" };
  }
  if (body.startsWith("NONCE:")) {
    const nonce = body.substring(6);
    return /^[0-9a-fA-F]{32}$/.test(nonce) ? { kind: "nonce", nonce } : null;
  }
  if (body.startsWith("FAIL:")) {
    const n = parseInt(body.substring(5), 10);
    return Number.isNaN(n) ? null : { kind: "fail", triesLeft: n };
  }
  if (body.startsWith("LOCKED:")) {
    const n = parseInt(body.substring(7), 10);
    return Number.isNaN(n) ? null : { kind: "locked", seconds: n };
  }
  return null;
}

/**
 * Write `command` and resolve with the first handshake reply, or null after
 * `timeoutMs` of silence.
 */
export async function sendAuthCommand(
  connection: BleConnection,
  command: string,
  timeoutMs = REPLY_TIMEOUT_MS,
): Promise<AuthReply | null> {
  const status = connection.characteristics.fileStatus;
  return new Promise<AuthReply | null>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handle = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      for (const line of raw.split("\n")) {
        const reply = parseAuthReply(line);
        if (reply) {
          finish();
          resolve(reply);
          return;
        }
      }
    };
    const finish = () => {
      if (timer) clearTimeout(timer);
      status.removeEventListener("characteristicvaluechanged", handle);
    };
    (async () => {
      await status.startNotifications();
      status.addEventListener("characteristicvaluechanged", handle);
      bleLog("AUTH →", command.startsWith("AUTH:") ? "AUTH:<answer>" : command);
      await connection.characteristics.fileRequest.writeValue(new TextEncoder().encode(command));
      timer = setTimeout(() => {
        finish();
        resolve(null);
      }, timeoutMs);
    })().catch((err: unknown) => {
      finish();
      reject(err);
    });
  });
}

/** Why the PIN is being asked for. */
export interface PinPromptContext {
  /** The logger's advertised name, for the prompt's title. */
  deviceName: string;
  /** Set when the previous answer was wrong: how many tries remain before a lockout. */
  triesLeft?: number;
}

/** Thrown when the handshake ends without access. `code` drives the UI copy. */
export class LoggerAuthError extends Error {
  constructor(
    readonly code: "cancelled" | "locked" | "camera" | "timeout" | "busy" | "protocol",
    readonly seconds?: number,
  ) {
    super(`logger-auth:${code}`);
    this.name = "LoggerAuthError";
  }
}

export interface AuthenticateOptions {
  /** Ask the user for the PIN; resolve null to give up. */
  promptPin: (ctx: PinPromptContext) => Promise<string | null>;
}

/** How the connection was cleared for use. */
export type AuthOutcome = "open" | "authed" | "legacy";

/**
 * Run the handshake on a fresh connection. Resolves once the logger accepts
 * commands; rejects with `LoggerAuthError` otherwise (the caller disconnects).
 *
 * The stored PIN is tried first and silently; a wrong one is forgotten and the
 * user is asked. On an open (locally started) session the PIN is fetched and
 * stored, so the next remote start needs no typing.
 */
export async function authenticateLogger(
  connection: BleConnection,
  { promptPin }: AuthenticateOptions,
): Promise<AuthOutcome> {
  const device = connection.device;
  const deviceName = device.name ?? "";
  const first = await sendAuthCommand(connection, "AUTH?", LEGACY_TIMEOUT_MS);
  if (first === null) return "legacy";
  if (first.kind === "open") {
    const pin = await sendAuthCommand(connection, "PINGET");
    if (pin?.kind === "pin") saveLoggerPin(device.id, pin.pin);
    return "open";
  }
  if (first.kind === "ok") return "authed";

  let reply: AuthReply | null = first;
  let pin = loadLoggerPin(device.id);
  let triesLeft: number | undefined;
  for (;;) {
    if (reply === null) throw new LoggerAuthError("timeout");
    switch (reply.kind) {
      case "locked": throw new LoggerAuthError("locked", reply.seconds);
      case "camera": throw new LoggerAuthError("camera");
      case "timeout": throw new LoggerAuthError("timeout");
      case "busy": throw new LoggerAuthError("busy");
      case "ok": return "authed";
      case "nonce": break;
      default: throw new LoggerAuthError("protocol");
    }

    if (pin === null) {
      const entered = await promptPin({ deviceName, triesLeft });
      if (entered === null) throw new LoggerAuthError("cancelled");
      if (!isValidPin(entered)) continue;
      pin = entered;
    }

    const verdict = await sendAuthCommand(connection, `AUTH:${await computeAuthAnswer(pin, reply.nonce)}`);
    if (verdict?.kind === "ok") {
      saveLoggerPin(device.id, pin);
      return "authed";
    }
    if (verdict?.kind !== "fail" && verdict?.kind !== "noNonce") {
      reply = verdict;
      continue;
    }
    if (verdict.kind === "fail") {
      // A stored PIN that no longer works (changed on the logger) is dropped
      // so it can't keep burning tries.
      forgetLoggerPin(device.id);
      triesLeft = verdict.triesLeft;
      pin = null;
    }
    // The logger consumes the nonce on every check: ask for a fresh one.
    reply = await sendAuthCommand(connection, "AUTH?");
  }
}
