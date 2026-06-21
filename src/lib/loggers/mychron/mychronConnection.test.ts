import { describe, it, expect, vi, beforeEach } from "vitest";
import * as ipc from "./ipc";
import { createMychronConnection } from "./mychronConnection";

vi.mock("./ipc", () => ({
  loggerListFiles: vi.fn(),
  loggerDownloadFile: vi.fn(),
  loggerDisconnect: vi.fn(),
}));

function info(overrides: Partial<ipc.LoggerDeviceInfo> = {}): ipc.LoggerDeviceInfo {
  return { kind: "mychron", fields: {}, ...overrides };
}

describe("createMychronConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a MyChron without in-app device details", () => {
    const conn = createMychronConnection(info({ name: "Pilot 7" }));
    expect(conn.kind).toBe("mychron");
    expect(conn.supportsDeviceDetails).toBe(false);
    expect(conn.displayName).toBe("Pilot 7");
  });

  it("falls back name → model → brand for the display name", () => {
    expect(createMychronConnection(info({ model: "MyChron 5S" })).displayName).toBe("MyChron 5S");
    expect(createMychronConnection(info()).displayName).toBe("AiM MyChron");
  });

  it("maps device file entries down to the generic LoggerFile shape", async () => {
    vi.mocked(ipc.loggerListFiles).mockResolvedValue([
      { name: "a_0217.xrz", size: 1234, date: "2026-02-17", meta: { nlap: "12" } },
    ]);
    const conn = createMychronConnection(info());
    await expect(conn.listLogs()).resolves.toEqual([{ name: "a_0217.xrz", size: 1234 }]);
  });

  it("wraps raw {received,total} progress into a full LoggerDownloadProgress", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(ipc.loggerDownloadFile).mockImplementation(async (_name, onProgress) => {
      onProgress({ received: 50, total: 100 });
      return bytes;
    });
    const conn = createMychronConnection(info());
    const onProgress = vi.fn();

    await expect(conn.downloadLog("a_0217.xrz", onProgress)).resolves.toBe(bytes);
    expect(ipc.loggerDownloadFile).toHaveBeenCalledWith("a_0217.xrz", expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ received: 50, total: 100, percent: 50 }),
    );
    const reported = onProgress.mock.calls[0][0];
    expect(reported).toHaveProperty("speed");
    expect(reported).toHaveProperty("eta");
  });

  it("delegates disconnect to the IPC teardown", () => {
    createMychronConnection(info()).disconnect();
    expect(ipc.loggerDisconnect).toHaveBeenCalled();
  });
});
