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
 * `AUTH?` and says nothing; silence for `LEGACY_TIMEOUT_MS` is then confirmed
 * with a settings read (a locked logger answers it `AUTH:REQUIRED`) so a slow
 * reply is never mistaken for old firmware.
 *
 * The logger can also end the session on its own with a notice before it
 * drops the link: `AUTH:TIMEOUT` (20 s without authenticating), `AUTH:CAMERA`
 * (the Insta360 needs the radio), `AUTH:ENGINE` (the engine started) and
 * `AUTH:IDLE` (10 min with no transfer commands). The handshake watches for
 * them, and for the GATT link dropping, the whole time — including while the
 * user is typing the PIN.
 */

/** How long to wait for an `AUTH?` reply before probing for pre-PIN firmware. */
export const LEGACY_TIMEOUT_MS = 2000;
/** How long the legacy probe (and a late `AUTH?` reply) may take. */
export const LEGACY_PROBE_TIMEOUT_MS = 3000;
/**
 * The legacy probe: every firmware answers a settings read — pre-PIN firmware
 * with `SVAL`/`SERR`, a locked logger with `AUTH:REQUIRED`.
 */
const LEGACY_PROBE = "SGET:bluetooth_name";
/** Reply wait for every other step (the answer check reads the card). */
export const REPLY_TIMEOUT_MS = 5000;
/** Pause before the single retry of a command the logger answered `AUTH:BUSY`. */
export const BUSY_RETRY_DELAY_MS = 500;
/** `AUTH:NO_NONCE` → fresh nonce rounds allowed before giving up. */
const MAX_NO_NONCE_RETRIES = 3;
/** Reconnects allowed per handshake after the link drops around the PIN prompt. */
const MAX_RECONNECTS = 2;
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


/** One parsed `AUTH:` / `PIN:` reply to a handshake command. */
export type AuthReply =
  | { kind: "open" }
  | { kind: "ok" }
  | { kind: "nonce"; nonce: string }
  | { kind: "fail"; triesLeft: number }
  | { kind: "locked"; seconds: number }
  | { kind: "noNonce" }
  | { kind: "busy" }
  | { kind: "required" }
  | { kind: "pin"; pin: string };

/** Parse a reply line, or null when it isn't one (link-end notices included). */
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

/** A notice the logger sends, unprompted, right before it ends the session. */
export type LinkEndNotice = "timeout" | "camera" | "engine" | "idle";
/** Why the link to the logger ended: a notice, or the GATT link just dropping. */
export type LinkEnd = LinkEndNotice | "lost";

/** Parse a session-ending notice (`AUTH:TIMEOUT|CAMERA|ENGINE|IDLE`), or null. */
export function parseLinkEndNotice(line: string): LinkEndNotice | null {
  switch (line.trim()) {
    case "AUTH:TIMEOUT": return "timeout";
    case "AUTH:CAMERA": return "camera";
    case "AUTH:ENGINE": return "engine";
    case "AUTH:IDLE": return "idle";
    default: return null;
  }
}

/** Every complete, non-empty line in a status notification. */
function notificationLines(event: Event): string[] {
  const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
  if (!value) return [];
  return new TextDecoder().decode(value).split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Internal: the link ended while the handshake was using it. */
class LinkEndedError extends Error {
  constructor(readonly end: LinkEnd) {
    super(`logger-link:${end}`);
    this.name = "LinkEndedError";
  }
}

/**
 * The handshake's view of one connection: a queue of status lines plus a
 * watch on the link. Lines are only accepted after the command that asks for
 * them (`send` empties the queue), and each step names the replies it accepts,
 * so a stale or interleaved line can never be read as an answer.
 */
class AuthChannel {
  ended: LinkEnd | null = null;
  private lines: string[] = [];
  private wake: (() => void) | null = null;
  private readonly endListeners = new Set<(end: LinkEnd) => void>();

  constructor(readonly connection: BleConnection) {}

  private readonly onStatus = (event: Event) => {
    for (const line of notificationLines(event)) {
      const notice = parseLinkEndNotice(line);
      if (notice) this.end(notice);
      else this.lines.push(line);
    }
    this.poke();
  };

  private readonly onDisconnect = () => this.end("lost");

  async open(): Promise<void> {
    this.connection.device.addEventListener("gattserverdisconnected", this.onDisconnect);
    const status = this.connection.characteristics.fileStatus;
    status.addEventListener("characteristicvaluechanged", this.onStatus);
    await status.startNotifications();
  }

  close(): void {
    this.connection.device.removeEventListener("gattserverdisconnected", this.onDisconnect);
    this.connection.characteristics.fileStatus.removeEventListener("characteristicvaluechanged", this.onStatus);
    this.endListeners.clear();
  }

  /** Call `cb` when the link ends; returns the unsubscribe. */
  onEnd(cb: (end: LinkEnd) => void): () => void {
    this.endListeners.add(cb);
    return () => this.endListeners.delete(cb);
  }

  private end(end: LinkEnd): void {
    if (this.ended) return;
    this.ended = end;
    for (const cb of this.endListeners) cb(end);
    this.poke();
  }

  private poke(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private throwIfEnded(): void {
    if (this.ended) throw new LinkEndedError(this.ended);
  }

  async send(command: string): Promise<void> {
    this.throwIfEnded();
    this.lines = [];
    bleLog("AUTH →", command.startsWith("AUTH:") ? "AUTH:<answer>" : command);
    await this.connection.characteristics.fileRequest.writeValue(new TextEncoder().encode(command));
  }

  /** The first queued or incoming line `match` accepts, or null after `timeoutMs`. */
  async expect<T>(match: (line: string) => T | null, timeoutMs: number): Promise<T | null> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.poke();
    }, timeoutMs);
    try {
      for (;;) {
        this.throwIfEnded();
        while (this.lines.length > 0) {
          const hit = match(this.lines.shift()!);
          if (hit !== null) return hit;
        }
        if (timedOut) return null;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A matcher accepting only the listed reply kinds. */
function only<K extends AuthReply["kind"]>(...kinds: K[]) {
  return (line: string): Extract<AuthReply, { kind: K }> | null => {
    const reply = parseAuthReply(line);
    return reply && (kinds as string[]).includes(reply.kind)
      ? (reply as Extract<AuthReply, { kind: K }>)
      : null;
  };
}

/** Replies to `AUTH?`. */
const NONCE_REPLY = only("nonce", "open", "ok", "locked", "busy");
/** Replies to `AUTH:<answer>`. */
const VERDICT_REPLY = only("ok", "fail", "locked", "noNonce", "busy");

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Send `command`; on `AUTH:BUSY` wait briefly and send it once more. */
async function ask<T extends AuthReply>(
  ch: AuthChannel,
  command: string,
  match: (line: string) => T | null,
): Promise<T | null> {
  await ch.send(command);
  const reply = await ch.expect(match, REPLY_TIMEOUT_MS);
  if (reply?.kind !== "busy") return reply;
  await delay(BUSY_RETRY_DELAY_MS);
  await ch.send(command);
  return ch.expect(match, REPLY_TIMEOUT_MS);
}

/** Why the PIN is being asked for. */
export interface PinPromptContext {
  /** The logger's advertised name, for the prompt's title. */
  deviceName: string;
  /** Set when the previous answer was wrong: how many tries remain before a lockout. */
  triesLeft?: number;
}

/** What the handshake is doing, for the connect flow's status line. */
export type AuthPhase = "handshake" | "pin" | "reconnecting";

/** Thrown when the handshake ends without access. `code` drives the UI copy. */
export class LoggerAuthError extends Error {
  constructor(
    readonly code:
      | "cancelled"
      | "locked"
      | "busy"
      | "noReply"
      | "disconnected"
      | "protocol"
      | LinkEndNotice,
    readonly seconds?: number,
  ) {
    super(`logger-auth:${code}`);
    this.name = "LoggerAuthError";
  }
}

function linkEndError(end: LinkEnd): LoggerAuthError {
  return new LoggerAuthError(end === "lost" ? "disconnected" : end);
}

export interface AuthenticateOptions {
  /**
   * Ask the user for the PIN; resolve null to give up. `signal` aborts when
   * the logger ends the session for good while the prompt is open — the
   * prompt should close (resolving null is fine; the abort wins).
   */
  promptPin: (ctx: PinPromptContext, signal: AbortSignal) => Promise<string | null>;
  /**
   * Reopen the GATT link to the same logger. When the link drops (or the
   * logger's 20 s squat limit runs out) around the PIN prompt — reading the
   * PIN means leaving the logger's main menu — the handshake reconnects and
   * reruns with the typed PIN. Without it, a dropped link just fails.
   */
  reconnect?: () => Promise<BleConnection>;
  /** Progress for the connect flow's status line. */
  onPhase?: (phase: AuthPhase) => void;
}

/** How the connection was cleared for use. */
export type AuthOutcome = "open" | "authed" | "legacy";

export interface AuthResult {
  outcome: AuthOutcome;
  /** The connection to use: a fresh one when the handshake had to reconnect. */
  connection: BleConnection;
}

/** Mutable state that survives a reconnect. */
interface HandshakeState {
  /** A PIN the user typed that the logger hasn't ruled on yet. */
  typedPin: string | null;
}

/**
 * `AUTH?` with the legacy check: silence, then a settings-read probe. A late
 * reply to `AUTH?` still wins, and `AUTH:REQUIRED` to the probe means the
 * nonce got lost, so ask again.
 */
async function openingReply(ch: AuthChannel): Promise<AuthReply | "legacy"> {
  await ch.send("AUTH?");
  const first = await ch.expect(NONCE_REPLY, LEGACY_TIMEOUT_MS);
  if (first?.kind === "busy") {
    await delay(BUSY_RETRY_DELAY_MS);
    await ch.send("AUTH?");
    const retried = await ch.expect(NONCE_REPLY, REPLY_TIMEOUT_MS);
    if (!retried) throw new LoggerAuthError("noReply");
    return retried;
  }
  if (first) return first;

  await ch.send(LEGACY_PROBE);
  const probe = await ch.expect<AuthReply | "legacy">((line) => {
    const reply = NONCE_REPLY(line) ?? only("required")(line);
    if (reply) return reply;
    return /^(SVAL:|SERR:|SBUSY)/.test(line) ? "legacy" : null;
  }, LEGACY_PROBE_TIMEOUT_MS);
  // Nothing at all to a settings read: behave as the app always did.
  if (probe === null || probe === "legacy") return "legacy";
  if (probe.kind !== "required") return probe;
  const again = await ask(ch, "AUTH?", NONCE_REPLY);
  if (!again) throw new LoggerAuthError("noReply");
  return again;
}

/** On an open session, fetch and store the PIN so a later remote start needs no typing. */
async function learnPin(ch: AuthChannel, deviceId: string): Promise<void> {
  await ch.send("PINGET");
  const reply = await ch.expect<AuthReply | "none">((line) => {
    const r = only("pin", "required")(line);
    if (r) return r;
    return /^(SERR|SBUSY)/.test(line) ? "none" : null;
  }, REPLY_TIMEOUT_MS);
  if (reply !== null && reply !== "none" && reply.kind === "pin") saveLoggerPin(deviceId, reply.pin);
}

/**
 * Ask the user for a PIN. The prompt is closed (and this throws) if the
 * logger ends the session in a way a reconnect can't fix; a plain drop or the
 * squat timeout leaves it open when `canReconnect`, since the user is most
 * likely off reading the PIN on the logger.
 */
async function promptForPin(
  ch: AuthChannel,
  promptPin: AuthenticateOptions["promptPin"],
  ctx: PinPromptContext,
  canReconnect: boolean,
): Promise<string> {
  const recoverable = (end: LinkEnd) => canReconnect && (end === "lost" || end === "timeout");
  if (ch.ended && !recoverable(ch.ended)) throw new LinkEndedError(ch.ended);
  const abort = new AbortController();
  let off: () => void = () => {};
  const aborted = new Promise<null>((resolve) => {
    off = ch.onEnd((end) => {
      if (recoverable(end)) return;
      abort.abort();
      resolve(null);
    });
  });
  try {
    for (;;) {
      const entered = await Promise.race([promptPin(ctx, abort.signal), aborted]);
      if (abort.signal.aborted) throw new LinkEndedError(ch.ended!);
      if (entered === null) throw new LoggerAuthError("cancelled");
      if (isValidPin(entered)) return entered;
    }
  } finally {
    off();
  }
}

async function handshake(
  ch: AuthChannel,
  state: HandshakeState,
  { promptPin, reconnect, onPhase }: AuthenticateOptions,
): Promise<AuthOutcome> {
  const device = ch.connection.device;
  const deviceName = device.name ?? "";
  await ch.open();

  let reply: AuthReply | null | "legacy" = await openingReply(ch);
  if (reply === "legacy") return "legacy";
  if (reply.kind === "open") {
    await learnPin(ch, device.id);
    return "open";
  }

  onPhase?.("pin");
  let pin = state.typedPin ?? loadLoggerPin(device.id);
  let triesLeft: number | undefined;
  let noNonceRounds = 0;
  for (;;) {
    if (reply === null) throw new LoggerAuthError("noReply");
    switch (reply.kind) {
      case "ok": return "authed";
      case "locked": throw new LoggerAuthError("locked", reply.seconds);
      case "busy": throw new LoggerAuthError("busy");
      case "nonce": break;
      default: throw new LoggerAuthError("protocol");
    }
    const nonce = reply.nonce;

    if (pin === null) {
      pin = await promptForPin(ch, promptPin, { deviceName, triesLeft }, reconnect !== undefined);
      state.typedPin = pin;
    }

    const verdict = await ask(ch, `AUTH:${await computeAuthAnswer(pin, nonce)}`, VERDICT_REPLY);
    if (verdict === null) throw new LoggerAuthError("noReply");
    switch (verdict.kind) {
      case "ok":
        saveLoggerPin(device.id, pin);
        state.typedPin = null;
        return "authed";
      case "fail":
        // A PIN the logger rejects is dropped (stored or typed), so it can't
        // keep burning tries on later connects.
        forgetLoggerPin(device.id);
        state.typedPin = null;
        pin = null;
        triesLeft = verdict.triesLeft;
        break;
      case "locked":
        forgetLoggerPin(device.id);
        state.typedPin = null;
        throw new LoggerAuthError("locked", verdict.seconds);
      case "noNonce":
        if (++noNonceRounds > MAX_NO_NONCE_RETRIES) throw new LoggerAuthError("protocol");
        break;
      case "busy":
        throw new LoggerAuthError("busy");
    }
    // The logger consumes the nonce on every check: ask for a fresh one.
    reply = await ask(ch, "AUTH?", NONCE_REPLY);
  }
}

/**
 * Run the handshake on a fresh connection. Resolves once the logger accepts
 * commands, with the connection to use (a new one if it had to reconnect);
 * rejects with `LoggerAuthError` otherwise (the caller disconnects).
 *
 * The stored PIN is tried first and silently; a rejected one is forgotten and
 * the user is asked. On an open (locally started) session the PIN is fetched
 * and stored, so the next remote start needs no typing.
 */
export async function authenticateLogger(
  connection: BleConnection,
  options: AuthenticateOptions,
): Promise<AuthResult> {
  const state: HandshakeState = { typedPin: null };
  let conn = connection;
  let reconnects = 0;
  options.onPhase?.("handshake");
  for (;;) {
    const ch = new AuthChannel(conn);
    try {
      const outcome = await handshake(ch, state, options);
      return { outcome, connection: conn };
    } catch (err) {
      if (err instanceof LoggerAuthError && err.code === "cancelled") throw err;
      const end: LinkEnd | null =
        ch.ended ?? (err instanceof LinkEndedError ? err.end : null)
          ?? (conn.device.gatt?.connected === false ? "lost" : null);
      const retry =
        (end === "lost" || end === "timeout")
        && state.typedPin !== null
        && options.reconnect !== undefined
        && reconnects < MAX_RECONNECTS;
      if (retry) {
        reconnects++;
        options.onPhase?.("reconnecting");
        try {
          conn = await options.reconnect!();
        } catch {
          throw new LoggerAuthError("disconnected");
        }
        continue;
      }
      if (end) throw linkEndError(end);
      if (err instanceof LoggerAuthError) throw err;
      // GATT, write or WebCrypto failures: still a failed connect the user
      // should hear about.
      bleLog("AUTH handshake failed:", err);
      throw new LoggerAuthError("protocol");
    } finally {
      ch.close();
    }
  }
}

/**
 * After the handshake: report the session-ending notices the logger can send
 * on an open link (`AUTH:CAMERA`, `AUTH:ENGINE`, `AUTH:IDLE`, `AUTH:TIMEOUT`)
 * just before it drops it. Returns the unsubscribe.
 */
export function watchLinkEndNotices(
  connection: BleConnection,
  onNotice: (notice: LinkEndNotice) => void,
): () => void {
  const status = connection.characteristics.fileStatus;
  const handle = (event: Event) => {
    for (const line of notificationLines(event)) {
      const notice = parseLinkEndNotice(line);
      if (notice) onNotice(notice);
    }
  };
  status.addEventListener("characteristicvaluechanged", handle);
  return () => status.removeEventListener("characteristicvaluechanged", handle);
}
