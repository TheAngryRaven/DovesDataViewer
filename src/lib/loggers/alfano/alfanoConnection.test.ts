import { describe, it, expect, vi, beforeEach } from "vitest";
import * as ipc from "./ipc";
import { createAlfanoConnection } from "./alfanoConnection";

vi.mock("./ipc", () => ({
  loggerListFiles: vi.fn(),
  loggerDownloadFile: vi.fn(),
  loggerDisconnect: vi.fn(),
}));

function info(overrides: Partial<ipc.LoggerDeviceInfo> = {}): ipc.LoggerDeviceInfo {
  return { kind: "alfano", fields: {}, ...overrides };
}

describe("createAlfanoConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports an alfano without in-app device details", () => {
    const conn = createAlfanoConnection(info({ name: "Alfano 6" }));
    expect(conn.kind).toBe("alfano");
    expect(conn.supportsDeviceDetails).toBe(false);
    expect(conn.displayName).toBe("Alfano 6");
  });

  it("falls back name → model → brand for the display name", () => {
    expect(createAlfanoConnection(info({ model: "Alfano 6+" })).displayName).toBe("Alfano 6+");
    expect(createAlfanoConnection(info()).displayName).toBe("Alfano");
  });

  it("maps device file entries down to the generic LoggerFile shape", async () => {
    vi.mocked(ipc.loggerListFiles).mockResolvedValue([
      { name: "session_01", size: 4096, date: "2026-06-28", meta: { laps: "8" } },
    ]);
    const conn = createAlfanoConnection(info());
    await expect(conn.listLogs()).resolves.toEqual([
      { name: "session_01", size: 4096, date: "2026-06-28", meta: { laps: "8" } },
    ]);
  });

  it("wraps raw {received,total} progress into a full LoggerDownloadProgress", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(ipc.loggerDownloadFile).mockImplementation(async (_name, onProgress) => {
      onProgress({ received: 50, total: 100 });
      return bytes;
    });
    const conn = createAlfanoConnection(info());
    const onProgress = vi.fn();

    await expect(conn.downloadLog("session_01", onProgress)).resolves.toBe(bytes);
    expect(ipc.loggerDownloadFile).toHaveBeenCalledWith("session_01", expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ received: 50, total: 100, percent: 50 }),
    );
    const reported = onProgress.mock.calls[0][0];
    expect(reported).toHaveProperty("speed");
    expect(reported).toHaveProperty("eta");
  });

  it("delegates disconnect to the IPC teardown", () => {
    createAlfanoConnection(info()).disconnect();
    expect(ipc.loggerDisconnect).toHaveBeenCalled();
  });
});
