import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  authenticateLogger,
  computeAuthAnswer,
  isValidPin,
  LEGACY_TIMEOUT_MS,
  LoggerAuthError,
  parseAuthReply,
} from "./auth";
import { loadLoggerPin, saveLoggerPin } from "./pinStore";
import { createMockConnection, flushMicrotasks, lastWritten, writeCount } from "./__test__/mockBle";

const NONCE = "00112233445566778899aabbccddeeff";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

function loggerConnection() {
  const conn = createMockConnection();
  (conn as { device: unknown }).device = { id: "dev-1", name: "BirdsEye-42", gatt: { connected: true } };
  return conn;
}

/** Let async work (WebCrypto included) settle until a new command is written. */
async function waitForWrite(char: Parameters<typeof writeCount>[0], count: number) {
  for (let i = 0; i < 50 && writeCount(char) < count; i++) {
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(writeCount(char)).toBe(count);
}

beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
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

describe("parseAuthReply", () => {
  it("parses every firmware reply", () => {
    expect(parseAuthReply(`AUTH:NONCE:${NONCE}`)).toEqual({ kind: "nonce", nonce: NONCE });
    expect(parseAuthReply("AUTH:FAIL:3")).toEqual({ kind: "fail", triesLeft: 3 });
    expect(parseAuthReply("AUTH:LOCKED:60")).toEqual({ kind: "locked", seconds: 60 });
    expect(parseAuthReply("AUTH:OPEN")).toEqual({ kind: "open" });
    expect(parseAuthReply("AUTH:OK\r")).toEqual({ kind: "ok" });
    expect(parseAuthReply("AUTH:CAMERA")).toEqual({ kind: "camera" });
    expect(parseAuthReply("AUTH:TIMEOUT")).toEqual({ kind: "timeout" });
    expect(parseAuthReply("PIN:0042")).toEqual({ kind: "pin", pin: "0042" });
  });

  it("ignores unrelated or malformed lines", () => {
    expect(parseAuthReply("BATT:50,3.7")).toBeNull();
    expect(parseAuthReply("AUTH:NONCE:xyz")).toBeNull();
    expect(parseAuthReply("PIN:12")).toBeNull();
    expect(parseAuthReply("AUTH:FAIL:")).toBeNull();
  });
});

describe("authenticateLogger", () => {
  it("treats silence as pre-PIN firmware", async () => {
    vi.useFakeTimers();
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await flushMicrotasks();
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("AUTH?");
    await vi.advanceTimersByTimeAsync(LEGACY_TIMEOUT_MS);
    await expect(result).resolves.toBe("legacy");
  });

  it("learns the PIN from an open (locally started) session", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn.characteristics.fileRequest, 1);
    conn.characteristics.fileStatus.simulate("AUTH:OPEN\n");
    await waitForWrite(conn.characteristics.fileRequest, 2);
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("PINGET");
    conn.characteristics.fileStatus.simulate("PIN:4821\n");
    await expect(result).resolves.toBe("open");
    expect(loadLoggerPin("dev-1", "BirdsEye-42")).toBe("4821");
  });

  it("answers silently with a stored PIN", async () => {
    saveLoggerPin("dev-1", "BirdsEye-42", "4821");
    const conn = loggerConnection();
    const promptPin = vi.fn();
    const result = authenticateLogger(conn, { promptPin });
    await waitForWrite(conn.characteristics.fileRequest, 1);
    conn.characteristics.fileStatus.simulate(`AUTH:NONCE:${NONCE}\n`);
    await waitForWrite(conn.characteristics.fileRequest, 2);
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("AUTH:4936f5dad4502101eb0f65790cca77b4");
    conn.characteristics.fileStatus.simulate("AUTH:OK\n");
    await expect(result).resolves.toBe("authed");
    expect(promptPin).not.toHaveBeenCalled();
  });

  it("falls back to the name when the browser hands out a new id", async () => {
    saveLoggerPin("old-id", "BirdsEye-42", "4821");
    expect(loadLoggerPin("dev-1", "BirdsEye-42")).toBe("4821");
  });

  it("forgets a rejected PIN and asks the user", async () => {
    saveLoggerPin("dev-1", "BirdsEye-42", "9999");
    const conn = loggerConnection();
    const promptPin = vi.fn().mockResolvedValue("4821");
    const result = authenticateLogger(conn, { promptPin });
    await waitForWrite(conn.characteristics.fileRequest, 1);
    conn.characteristics.fileStatus.simulate(`AUTH:NONCE:${NONCE}\n`);
    await waitForWrite(conn.characteristics.fileRequest, 2);
    conn.characteristics.fileStatus.simulate("AUTH:FAIL:4\n");
    await waitForWrite(conn.characteristics.fileRequest, 3);
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("AUTH?");
    expect(loadLoggerPin("dev-1", "BirdsEye-42")).toBeNull();
    conn.characteristics.fileStatus.simulate(`AUTH:NONCE:${NONCE}\n`);
    await waitForWrite(conn.characteristics.fileRequest, 4);
    expect(promptPin).toHaveBeenCalledWith({ deviceName: "BirdsEye-42", triesLeft: 4 });
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("AUTH:4936f5dad4502101eb0f65790cca77b4");
    conn.characteristics.fileStatus.simulate("AUTH:OK\n");
    await expect(result).resolves.toBe("authed");
    expect(loadLoggerPin("dev-1", "BirdsEye-42")).toBe("4821");
  });

  it("gives up when the user cancels the prompt", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn().mockResolvedValue(null) });
    await waitForWrite(conn.characteristics.fileRequest, 1);
    conn.characteristics.fileStatus.simulate(`AUTH:NONCE:${NONCE}\n`);
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
  });

  it("reports a lockout with its remaining seconds", async () => {
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn.characteristics.fileRequest, 1);
    conn.characteristics.fileStatus.simulate("AUTH:LOCKED:120\n");
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoggerAuthError);
    expect(err).toMatchObject({ code: "locked", seconds: 120 });
  });

  it("reports the camera taking the radio", async () => {
    saveLoggerPin("dev-1", "BirdsEye-42", "4821");
    const conn = loggerConnection();
    const result = authenticateLogger(conn, { promptPin: vi.fn() });
    await waitForWrite(conn.characteristics.fileRequest, 1);
    conn.characteristics.fileStatus.simulate(`AUTH:NONCE:${NONCE}\n`);
    await waitForWrite(conn.characteristics.fileRequest, 2);
    conn.characteristics.fileStatus.simulate("AUTH:CAMERA\n");
    await expect(result).rejects.toMatchObject({ code: "camera" });
  });
});
