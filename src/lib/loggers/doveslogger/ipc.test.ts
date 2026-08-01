import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock of the Tauri core API (dynamically imported by ../native/ipc).
const { invoke, ChannelMock } = vi.hoisted(() => {
  const invoke = vi.fn();
  class ChannelMock<T> {
    onmessage: ((m: T) => void) | null = null;
  }
  return { invoke, ChannelMock };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: ChannelMock }));

import {
  loggerScan,
  loggerConnect,
  loggerUpdateFirmware,
  loggerBattery,
  loggerListSettings,
  loggerSetSetting,
  loggerResetSettings,
  loggerListTracks,
  loggerDownloadTrack,
  loggerUploadTrack,
  loggerDeleteTrack,
} from "./ipc";

// The kind-agnostic commands (list / download / disconnect) are covered by
// ../native/ipc.test.ts; this suite asserts the DovesLogger-specific scan/connect.
describe("doveslogger ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans with the doveslogger kind and returns the device list", async () => {
    const devices = [{ id: "AA:BB", name: "BirdsEye", rssi: -52 }];
    invoke.mockResolvedValue(devices);
    await expect(loggerScan()).resolves.toEqual(devices);
    expect(invoke).toHaveBeenCalledWith("logger_scan", { kind: "doveslogger" });
  });

  it("connects to the chosen device by id (host)", async () => {
    invoke.mockResolvedValue({ kind: "doveslogger", fields: {} });
    await loggerConnect({ host: "AA:BB" });
    expect(invoke).toHaveBeenCalledWith("logger_connect", {
      kind: "doveslogger",
      host: "AA:BB",
    });
  });

  it("connects to the first logger found when no host is given", async () => {
    invoke.mockResolvedValue({ kind: "doveslogger", fields: {} });
    await loggerConnect();
    expect(invoke).toHaveBeenCalledWith("logger_connect", {
      kind: "doveslogger",
      host: undefined,
    });
  });

  it("passes backend error strings through unwrapped (prefix preserved)", async () => {
    invoke.mockRejectedValueOnce("device unreachable: permission denied");
    await expect(loggerScan()).rejects.toBe("device unreachable: permission denied");
  });

  it("uploads firmware with a progress channel and the raw image bytes", async () => {
    type Progress = { received: number; total: number };
    invoke.mockImplementation(
      async (_cmd: string, args: { onProgress: { onmessage: ((m: Progress) => void) | null } }) => {
        args.onProgress.onmessage?.({ received: 128, total: 256 });
      },
    );
    const image = new Uint8Array([1, 2, 3]);
    const onProgress = vi.fn();

    await loggerUpdateFirmware(image, onProgress);

    expect(invoke).toHaveBeenCalledWith("logger_update_firmware", {
      image,
      onProgress: expect.any(ChannelMock),
    });
    expect(onProgress).toHaveBeenCalledWith({ received: 128, total: 256 });
  });

  it("passes firmware rejections through unwrapped (unsupported/unknown-command intact)", async () => {
    invoke.mockRejectedValueOnce("unsupported: firmware update not available");
    await expect(loggerUpdateFirmware(new Uint8Array(), vi.fn())).rejects.toBe(
      "unsupported: firmware update not available",
    );
  });
});

// Device-tab commands (settings / tracks / battery) — thin wrappers, so the
// contract under test is the command name + camelCase arg keys.
describe("doveslogger device-tab ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the battery", async () => {
    invoke.mockResolvedValue({ percent: 88, voltage: 4.01 });
    await expect(loggerBattery()).resolves.toEqual({ percent: 88, voltage: 4.01 });
    expect(invoke).toHaveBeenCalledWith("logger_battery");
  });

  it("lists settings as a key → value map", async () => {
    invoke.mockResolvedValue({ driver_name: "Dove" });
    await expect(loggerListSettings()).resolves.toEqual({ driver_name: "Dove" });
    expect(invoke).toHaveBeenCalledWith("logger_list_settings");
  });

  it("writes a setting", async () => {
    invoke.mockResolvedValue(undefined);
    await loggerSetSetting("waypoint_speed", "20");
    expect(invoke).toHaveBeenCalledWith("logger_set_setting", {
      key: "waypoint_speed",
      value: "20",
    });
  });

  it("resets settings", async () => {
    invoke.mockResolvedValue(undefined);
    await loggerResetSettings();
    expect(invoke).toHaveBeenCalledWith("logger_reset_settings");
  });

  it("lists tracks", async () => {
    invoke.mockResolvedValue(["t.json"]);
    await expect(loggerListTracks()).resolves.toEqual(["t.json"]);
    expect(invoke).toHaveBeenCalledWith("logger_list_tracks");
  });

  it("downloads a track through a progress channel and returns bytes", async () => {
    invoke.mockResolvedValue(new Uint8Array([123, 125]).buffer);
    await expect(loggerDownloadTrack("t.json")).resolves.toEqual(new Uint8Array([123, 125]));
    expect(invoke).toHaveBeenCalledWith("logger_download_track", {
      name: "t.json",
      onProgress: expect.any(ChannelMock),
    });
  });

  it("uploads a track as raw bytes", async () => {
    invoke.mockResolvedValue(undefined);
    const data = new Uint8Array([1, 2]);
    await loggerUploadTrack("t.json", data);
    expect(invoke).toHaveBeenCalledWith("logger_upload_track", { name: "t.json", data });
  });

  it("deletes a track", async () => {
    invoke.mockResolvedValue(undefined);
    await loggerDeleteTrack("t.json");
    expect(invoke).toHaveBeenCalledWith("logger_delete_track", { name: "t.json" });
  });
});
