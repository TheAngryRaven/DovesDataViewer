import { describe, it, expect, vi, beforeEach } from "vitest";
import * as ipc from "./ipc";
import { createDovesloggerConnection } from "./dovesloggerConnection";

vi.mock("./ipc", () => ({
  loggerListFiles: vi.fn(),
  loggerDownloadFile: vi.fn(),
  loggerDisconnect: vi.fn(),
}));

function info(overrides: Partial<ipc.LoggerDeviceInfo> = {}): ipc.LoggerDeviceInfo {
  return { kind: "doveslogger", fields: {}, ...overrides };
}

describe("createDovesloggerConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a fledgling without in-app device details (native BLE)", () => {
    const conn = createDovesloggerConnection(info({ name: "BirdsEye-sense" }));
    expect(conn.kind).toBe("fledgling");
    expect(conn.supportsDeviceDetails).toBe(false);
    expect(conn.displayName).toBe("BirdsEye-sense");
  });

  it("falls back name → model → brand for the display name", () => {
    expect(createDovesloggerConnection(info({ model: "BirdsEye-sense" })).displayName).toBe("BirdsEye-sense");
    expect(createDovesloggerConnection(info()).displayName).toBe("PerchWerks Fledgling");
  });

  it("maps device file entries down to the generic LoggerFile shape", async () => {
    vi.mocked(ipc.loggerListFiles).mockResolvedValue([
      { name: "a_0217.dove", size: 1234, date: "2026-02-17", meta: { nlap: "12" } },
    ]);
    const conn = createDovesloggerConnection(info());
    await expect(conn.listLogs()).resolves.toEqual([{ name: "a_0217.dove", size: 1234 }]);
  });

  it("wraps raw {received,total} progress into a full LoggerDownloadProgress", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(ipc.loggerDownloadFile).mockImplementation(async (_name, onProgress) => {
      onProgress({ received: 50, total: 100 });
      return bytes;
    });
    const conn = createDovesloggerConnection(info());
    const onProgress = vi.fn();

    await expect(conn.downloadLog("a_0217.dove", onProgress)).resolves.toBe(bytes);
    expect(ipc.loggerDownloadFile).toHaveBeenCalledWith("a_0217.dove", expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ received: 50, total: 100, percent: 50 }),
    );
    const reported = onProgress.mock.calls[0][0];
    expect(reported).toHaveProperty("speed");
    expect(reported).toHaveProperty("eta");
  });

  it("delegates disconnect to the IPC teardown", () => {
    createDovesloggerConnection(info()).disconnect();
    expect(ipc.loggerDisconnect).toHaveBeenCalled();
  });
});
