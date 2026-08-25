import { describe, it, expect, vi, beforeEach } from "vitest";
import * as ipc from "./ipc";
import { createDovesloggerConnection } from "./dovesloggerConnection";

vi.mock("./ipc", () => ({
  loggerListFiles: vi.fn(),
  loggerDownloadFile: vi.fn(),
  loggerDisconnect: vi.fn(),
  loggerBattery: vi.fn(),
  loggerListSettings: vi.fn(),
  loggerSetSetting: vi.fn(),
  loggerResetSettings: vi.fn(),
  loggerListTracks: vi.fn(),
  loggerDownloadTrack: vi.fn(),
  loggerUploadTrack: vi.fn(),
  loggerDeleteTrack: vi.fn(),
}));

function info(overrides: Partial<ipc.LoggerDeviceInfo> = {}): ipc.LoggerDeviceInfo {
  return { kind: "doveslogger", fields: {}, ...overrides };
}

describe("createDovesloggerConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a fledgling with the full in-app device-detail surface", () => {
    const conn = createDovesloggerConnection(info({ name: "BirdsEye-sense" }));
    expect(conn.kind).toBe("fledgling");
    expect(conn.supportsDeviceDetails).toBe(true);
    expect(conn.details).toBeDefined();
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
    await expect(conn.listLogs()).resolves.toEqual([
      { name: "a_0217.dove", size: 1234, date: "2026-02-17", meta: { nlap: "12" } },
    ]);
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

// ─── Sprint tracks over the native bridge (plan 0015) ────────────────────────

describe("native device details — sprint tracks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares that it can reach the sprint folder", () => {
    // The native bridge implements the TS* verbs, so the tab shows the sprint
    // list for real rather than explaining that this transport can't fetch it.
    expect(createDovesloggerConnection(info()).details!.supportsSprintTracks).toBe(true);
  });

  it("lists sprint tracks through the bridge", async () => {
    vi.mocked(ipc.loggerListTracks).mockResolvedValue(["autocross.json"]);
    const details = createDovesloggerConnection(info()).details!;
    await expect(details.listTracks("sprint")).resolves.toEqual(["autocross.json"]);
    expect(ipc.loggerListTracks).toHaveBeenCalledWith("sprint");
  });

  it("lists circuit tracks through the bridge", async () => {
    vi.mocked(ipc.loggerListTracks).mockResolvedValue(["OKC.json"]);
    const details = createDovesloggerConnection(info()).details!;
    await expect(details.listTracks("circuit")).resolves.toEqual(["OKC.json"]);
    await expect(details.listTracks()).resolves.toEqual(["OKC.json"]);
    expect(ipc.loggerListTracks).toHaveBeenCalledTimes(2);
  });

  // Every verb has to carry the kind, not just the listing: a sprint upload
  // that silently landed in /TRACKS would be the worst kind of wrong.
  it("forwards the kind on get / put / delete", async () => {
    const details = createDovesloggerConnection(info()).details!;
    const data = new Uint8Array([1, 2]);

    vi.mocked(ipc.loggerDownloadTrack).mockResolvedValue(data);
    await details.getTrack("autocross.json", "sprint");
    expect(ipc.loggerDownloadTrack).toHaveBeenCalledWith("autocross.json", "sprint");

    await details.putTrack("autocross.json", data, "sprint");
    expect(ipc.loggerUploadTrack).toHaveBeenCalledWith("autocross.json", data, "sprint");

    await details.deleteTrack("autocross.json", "sprint");
    expect(ipc.loggerDeleteTrack).toHaveBeenCalledWith("autocross.json", "sprint");
  });
});
