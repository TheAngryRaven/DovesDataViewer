import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  authenticateLogger,
  BUSY_RETRY_DELAY_MS,
  computeAuthAnswer,
  isValidPin,
  LEGACY_PROBE_TIMEOUT_MS,
  LEGACY_TIMEOUT_MS,
  LoggerAuthError,
  parseAuthReply,
  parseLinkEndNotice,
  REPLY_TIMEOUT_MS,
  watchLinkEndNotices,
  type PinPromptContext,
} from "./auth";
import { loadLoggerPin, saveLoggerPin } from "./pinStore";
import { createMockConnection, lastWritten, writeCount } from "./__test__/mockBle";
import type { BleConnection } from "./types";

const NONCE = "00112233445566778899aabbccddeeff";
/** computeAuthAnswer("4821", NONCE) — the firmware golden vector. */
const ANSWER_4821 = "AUTH:4936f5dad4502101eb0f65790cca77b4";

// Captured before any test fakes timers: waiting on WebCrypto needs real time.
const realSetTimeout = globalThis.setTimeout;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

type MockLogger = ReturnType<typeof createMockConnection> & {
  device: EventTarget & { id: string; name: string; gatt: { connected: boolean } };
};

function loggerConnection(): MockLogger {
  const conn = createMockConnection();
  const device = Object.assign(new EventTarget(), { id: "dev-1", name: "BirdsEye-42", gatt: { connected: true } });
  (conn as { device: unknown }).device = device;
  return conn as MockLogger;
}

/** The logger drops the GATT link. */
function drop(conn: MockLogger) {
  conn.device.gatt.connected = false;
  conn.device.dispatchEvent(new Event("gattserverdisconnected"));
}

const req = (conn: MockLogger) => conn.characteristics.fileRequest;
const reply = (conn: MockLogger, line: string) => conn.characteristics.fileStatus.simulate(`${line}\n`);

/** Let async work (WebCrypto included) settle until `count` commands were written. */
async function waitForWrite(conn: MockLogger, count: number) {
  for (let i = 0; i < 200 && writeCount(req(conn)) < count; i++) {
    await new Promise((r) => realSetTimeout(r, 1));
  }
  expect(writeCount(req(conn))).toBe(count);
}

/** A PIN prompt the test answers by hand. */
function manualPrompt() {
  const calls: { ctx: PinPromptContext; signal: AbortSignal; answer: (pin: string | null) => void }[] = [];
  const promptPin = vi.fn((ctx: PinPromptContext, signal: AbortSignal) =>
    new Promise<string | null>((resolve) => calls.push({ ctx, signal, answer: resolve })));
  return { promptPin, calls };
}

async function waitForPrompt(calls: unknown[], count: number) {
  for (let i = 0; i < 200 && calls.length < count; i++) {
    await new Promise((r) => realSetTimeout(r, 1));
  }
  expect(calls.length).toBe(count);
}

/** Drive a locked logger to the point where it has handed out a nonce. */
async function startLocked(conn: MockLogger) {
  await waitForWrite(conn, 1);
  expect(lastWritten(req(conn))).toBe("AUTH?");
  reply(conn, `AUTH:NONCE:${NONCE}`);
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("computeAuthAnswer", () => {
  // Golden vectors shared with the firmware's tests/remote_auth_test.cpp and
  // LapWing's doveslogger auth tests — all three must agree byte for byte.
  it("matches the firmware golden vector", async () => {
    await expect(computeAuthAnswer("4821", NONCE)).resolves.toBe("4936f5dad4502101eb0f65790cca77b4");
  });

  it("matches the second golden vector", async () => {
    await expect(computeAuthAnswer("1000", "f".repeat(32))).resolves.toBe("3db7fac4dc48559fa85594079b59fce4");
  });
});

describe("isValidPin", () => {
  it("accepts exactly four digits", () => {
    expect(isValidPin("0042")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
  });
});

describe("parseAuthReply / parseLinkEndNotice", () => {
  it("parses every firmware reply", () => {
    expect(parseAuthReply(`AUTH:NONCE:${NONCE}`)).toEqual({ kind: "nonce", nonce: NONCE });
    expect(parseAuthReply("AUTH:FAIL:3")).toEqual({ kind: "fail", triesLeft: 3 });
    expect(parseAuthReply("AUTH:LOCKED:60")).toEqual({ kind: "locked", seconds: 60 });
    expect(parseAuthReply("AUTH:OPEN")).toEqual({ kind: "open" });
    expect(parseAuthReply("AUTH:OK\r")).toEqual({ kind: "ok" });
    expect(parseAuthReply("AUTH:NO_NONCE")).toEqual({ kind: "noNonce" });
    expect(parseAuthReply("AUTH:BUSY")).toEqual({ kind: "busy" });
    expect(parseAuthReply("AUTH:REQUIRED")).toEqual({ kind: "required" });
    expect(parseAuthReply("PIN:0042")).toEqual({ kind: "pin", pin: "0042" });
  });

  it("parses the session-ending notices separately", () => {
    expect(parseLinkEndNotice("AUTH:TIMEOUT")).toBe("timeout");
    expect(parseLinkEndNotice("AUTH:CAMERA\r")).toBe("camera");
    expect(parseLinkEndNotice("AUTH:ENGINE")).toBe("engine");
    expect(parseLinkEndNotice("AUTH:IDLE")).toBe("idle");
    expect(parseLinkEndNotice("AUTH:OK")).toBeNull();
    expect(parseAuthReply("AUTH:CAMERA")).toBeNull();
  });

  it("ignores unrelated or malformed lines", () => {
    expect(parseAuthReply("BATT:50,3.7")).toBeNull();
    expect(parseAuthReply("AUTH:NONCE:xyz")).toBeNull();
    expect(parseAuthReply("PIN:12")).toBeNull();
    expect(parseAuthReply("AUTH:FAIL:")).toBeNull();
  });
});

describe("authenticateLogger — opening", () => {
  it("confirms pre-PIN firmware with a settings read after the silence", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    await vi.advanceTimersByTimeAsync(LEGACY_TIMEOUT_MS);
    await waitForWrite(conn, 2);
    expect(lastWritten(req(conn))).toBe("SGET:bluetooth_name");
    reply(conn, "SVAL:bluetooth_name=Logger-1");
    await expect(result).resolves.toMatchObject({ outcome: "legacy", connection: conn });
  });

  it("treats total silence as pre-PIN firmware", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    await vi.advanceTimersByTimeAsync(LEGACY_TIMEOUT_MS);
    await waitForWrite(conn, 2);
    await vi.advanceTimersByTimeAsync(LEGACY_PROBE_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({ outcome: "legacy" });
  });

  it("does not mistake a nonce that arrives after the silence for legacy firmware", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    await vi.advanceTimersByTimeAsync(LEGACY_TIMEOUT_MS);
    await waitForWrite(conn, 2);
    reply(conn, `AUTH:NONCE:${NONCE}`);
    await waitForWrite(conn, 3);
    expect(lastWritten(req(conn))).toBe(ANSWER_4821);
    // The probe's AUTH:REQUIRED lands late; it must not be read as the verdict.
    reply(conn, "AUTH:REQUIRED");
    reply(conn, "AUTH:OK");
    await expect(result).resolves.toMatchObject({ outcome: "authed" });
  });

  it("asks for a fresh nonce when the probe says a PIN is required", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    await vi.advanceTimersByTimeAsync(LEGACY_TIMEOUT_MS);
    await waitForWrite(conn, 2);
    reply(conn, "AUTH:REQUIRED");
    await waitForWrite(conn, 3);
    expect(lastWritten(req(conn))).toBe("AUTH?");
    reply(conn, `AUTH:NONCE:${NONCE}`);
    await waitForWrite(conn, 4);
    reply(conn, "AUTH:OK");
    await expect(result).resolves.toMatchObject({ outcome: "authed" });
  });

  it("learns the PIN from an open (locally started) session", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    reply(conn, "AUTH:OPEN");
    await waitForWrite(conn, 2);
    expect(lastWritten(req(conn))).toBe("PINGET");
    reply(conn, "PIN:4821");
    await expect(result).resolves.toMatchObject({ outcome: "open" });
    expect(loadLoggerPin("dev-1")).toBe("4821");
  });

  it("does not wait out PINGET when the logger refuses it", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    reply(conn, "AUTH:OPEN");
    await waitForWrite(conn, 2);
    reply(conn, "SERR:NOT_FOUND");
    await expect(result).resolves.toMatchObject({ outcome: "open" });
    expect(loadLoggerPin("dev-1")).toBeNull();
  });

  it("retries once when the logger is busy", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    reply(conn, "AUTH:BUSY");
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_DELAY_MS);
    await waitForWrite(conn, 2);
    expect(lastWritten(req(conn))).toBe("AUTH?");
    reply(conn, `AUTH:NONCE:${NONCE}`);
    await waitForWrite(conn, 3);
    // Busy on the answer (the logger couldn't read its PIN): resend it once.
    reply(conn, "AUTH:BUSY");
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_DELAY_MS);
    await waitForWrite(conn, 4);
    expect(lastWritten(req(conn))).toBe(ANSWER_4821);
    reply(conn, "AUTH:OK");
    await expect(result).resolves.toMatchObject({ outcome: "authed" });
  });

  it("gives up when the logger stays busy", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    reply(conn, "AUTH:BUSY");
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_DELAY_MS);
    await waitForWrite(conn, 3);
    reply(conn, "AUTH:BUSY");
    await expect(result).rejects.toMatchObject({ code: "busy" });
    expect(loadLoggerPin("dev-1")).toBe("4821");
  });
});

describe("authenticateLogger — PIN", () => {
  it("answers silently with a stored PIN", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const promptPin = vi.fn();
    const result = authenticateLogger(conn, { promptPin });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    expect(lastWritten(req(conn))).toBe(ANSWER_4821);
    // An unrelated notification in between is not a verdict.
    reply(conn, "BATT:80,3.9");
    reply(conn, "AUTH:OK");
    await expect(result).resolves.toMatchObject({ outcome: "authed" });
    expect(promptPin).not.toHaveBeenCalled();
  });

  it("forgets a rejected PIN and asks the user", async () => {
    saveLoggerPin("dev-1", "9999");
    const conn = loggerConnection();
    const promptPin = vi.fn().mockResolvedValue("4821");
    const result = authenticateLogger(conn, { promptPin });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    reply(conn, "AUTH:FAIL:4");
    await waitForWrite(conn, 3);
    expect(lastWritten(req(conn))).toBe("AUTH?");
    expect(loadLoggerPin("dev-1")).toBeNull();
    reply(conn, `AUTH:NONCE:${NONCE}`);
    await waitForWrite(conn, 4);
    expect(promptPin).toHaveBeenCalledWith({ deviceName: "BirdsEye-42", triesLeft: 4 }, expect.any(AbortSignal));
    expect(lastWritten(req(conn))).toBe(ANSWER_4821);
    reply(conn, "AUTH:OK");
    await expect(result).resolves.toMatchObject({ outcome: "authed" });
    expect(loadLoggerPin("dev-1")).toBe("4821");
  });

  it("gives up when the user cancels the prompt", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn().mockResolvedValue(null) });
    await startLocked(conn);
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
  });

  it("reports a lockout with its remaining seconds", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn, 1);
    reply(conn, "AUTH:LOCKED:120");
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoggerAuthError);
    expect(err).toMatchObject({ code: "locked", seconds: 120 });
  });

  it("reports a lockout triggered by a typed PIN and stores nothing", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn().mockResolvedValue("4821") });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    reply(conn, "AUTH:LOCKED:60");
    await expect(result).rejects.toMatchObject({ code: "locked", seconds: 60 });
    expect(loadLoggerPin("dev-1")).toBeNull();
  });

  it("forgets a stored PIN whose answer ends in a lockout", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    reply(conn, "AUTH:LOCKED:60");
    await expect(result).rejects.toMatchObject({ code: "locked" });
    expect(loadLoggerPin("dev-1")).toBeNull();
  });

  it("fetches a fresh nonce on NO_NONCE, a limited number of times", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await startLocked(conn);
    let writes = 2;
    for (let round = 0; round < 4; round++) {
      await waitForWrite(conn, writes);
      expect(lastWritten(req(conn))).toBe(ANSWER_4821);
      reply(conn, "AUTH:NO_NONCE");
      if (round === 3) break;
      await waitForWrite(conn, writes + 1);
      expect(lastWritten(req(conn))).toBe("AUTH?");
      reply(conn, `AUTH:NONCE:${NONCE}`);
      writes += 2;
    }
    await expect(result).rejects.toMatchObject({ code: "protocol" });
    // NO_NONCE says nothing about the PIN.
    expect(loadLoggerPin("dev-1")).toBe("4821");
  });

  it("reports a logger that stops answering", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    const settled = result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
    await expect(settled).resolves.toMatchObject({ code: "noReply" });
  });

  it("maps a failed write to a protocol error", async () => {
    const conn = loggerConnection();
    req(conn).writeValue = vi.fn().mockRejectedValue(new DOMException("GATT operation failed", "NetworkError"));
    await expect(authenticateLogger(conn, { promptPin: vi.fn() })).rejects.toMatchObject({ code: "protocol" });
  });
});

describe("authenticateLogger — the link ending", () => {
  it("reports the camera taking the radio", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    reply(conn, "AUTH:CAMERA");
    await expect(result).rejects.toMatchObject({ code: "camera" });
  });

  it("closes the prompt when the camera takes the radio mid-prompt", async () => {
    const conn = loggerConnection();
    const { promptPin, calls } = manualPrompt();
    const result = authenticateLogger(conn, { promptPin, reconnect: vi.fn() });
    await startLocked(conn);
    await waitForPrompt(calls, 1);
    reply(conn, "AUTH:CAMERA");
    await expect(result).rejects.toMatchObject({ code: "camera" });
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("closes the prompt on a drop when it can't reconnect", async () => {
    const conn = loggerConnection();
    const { promptPin, calls } = manualPrompt();
    const result = authenticateLogger(conn, { promptPin });
    await startLocked(conn);
    await waitForPrompt(calls, 1);
    drop(conn);
    await expect(result).rejects.toMatchObject({ code: "disconnected" });
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("reconnects and reuses the typed PIN after the logger left its menu", async () => {
    const conn = loggerConnection();
    const fresh = loggerConnection();
    const reconnect = vi.fn(async (): Promise<BleConnection> => fresh);
    const { promptPin, calls } = manualPrompt();
    const result = authenticateLogger(conn, { promptPin, reconnect });
    await startLocked(conn);
    await waitForPrompt(calls, 1);
    // The user opens Transfer → PIN on the logger: it drops the link. The
    // prompt stays open.
    drop(conn);
    await new Promise((r) => realSetTimeout(r, 5));
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].answer("4821");
    await startLocked(fresh);
    await waitForWrite(fresh, 2);
    expect(lastWritten(req(fresh))).toBe(ANSWER_4821);
    reply(fresh, "AUTH:OK");
    await expect(result).resolves.toMatchObject({ outcome: "authed", connection: fresh });
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(promptPin).toHaveBeenCalledTimes(1);
    expect(loadLoggerPin("dev-1")).toBe("4821");
  });

  it("reconnects after the squat limit runs out during the prompt", async () => {
    const conn = loggerConnection();
    const fresh = loggerConnection();
    const { promptPin, calls } = manualPrompt();
    const result = authenticateLogger(conn, { promptPin, reconnect: async () => fresh });
    await startLocked(conn);
    await waitForPrompt(calls, 1);
    reply(conn, "AUTH:TIMEOUT");
    drop(conn);
    calls[0].answer("4821");
    await startLocked(fresh);
    await waitForWrite(fresh, 2);
    reply(fresh, "AUTH:OK");
    await expect(result).resolves.toMatchObject({ outcome: "authed", connection: fresh });
  });

  it("reports a reconnect that fails", async () => {
    const conn = loggerConnection();
    const { promptPin, calls } = manualPrompt();
    const result = authenticateLogger(conn, {
      promptPin,
      reconnect: async () => { throw new DOMException("Connection attempt failed", "NetworkError"); },
    });
    await startLocked(conn);
    await waitForPrompt(calls, 1);
    drop(conn);
    calls[0].answer("4821");
    await expect(result).rejects.toMatchObject({ code: "disconnected" });
  });

  it("does not reconnect for a drop before any PIN was typed", async () => {
    saveLoggerPin("dev-1", "4821");
    const conn = loggerConnection();
    const reconnect = vi.fn();
    const result = authenticateLogger(conn, { promptPin: vi.fn(), reconnect });
    await startLocked(conn);
    await waitForWrite(conn, 2);
    drop(conn);
    await expect(result).rejects.toMatchObject({ code: "disconnected" });
    expect(reconnect).not.toHaveBeenCalled();
  });
});

describe("watchLinkEndNotices", () => {
  it("reports the notices that end an authenticated session", () => {
    const conn = loggerConnection();
    const seen: string[] = [];
    const stop = watchLinkEndNotices(conn, (n) => seen.push(n));
    reply(conn, "AUTH:ENGINE");
    reply(conn, "BATT:50,3.7");
    reply(conn, "AUTH:IDLE");
    stop();
    reply(conn, "AUTH:CAMERA");
    expect(seen).toEqual(["engine", "idle"]);
  });
});
