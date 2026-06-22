import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock of the Tauri core API (dynamically imported by ipc.ts).
const { invoke, ChannelMock } = vi.hoisted(() => {
  const invoke = vi.fn();
  class ChannelMock<T> {
    onmessage: ((m: T) => void) | null = null;
  }
  return { invoke, ChannelMock };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: ChannelMock }));

import { loggerDeviceInfo, loggerListFiles, loggerDownloadFile, loggerDisconnect } from "./ipc";

describe("native ipc (shared, kind-agnostic commands)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-reads device info without a kind arg", async () => {
    invoke.mockResolvedValue({ kind: "doveslogger", fields: {} });
    await loggerDeviceInfo();
    expect(invoke).toHaveBeenCalledWith("logger_device_info");
  });

  it("lists files without a kind arg", async () => {
    invoke.mockResolvedValue([]);
    await loggerListFiles();
    expect(invoke).toHaveBeenCalledWith("logger_list_files");
  });

  it("passes backend error strings through unwrapped (prefix preserved)", async () => {
    invoke.mockRejectedValueOnce("device unreachable: not joined");
    await expect(loggerListFiles()).rejects.toBe("device unreachable: not joined");
  });

  it("wires a progress Channel and returns the bytes as a Uint8Array", async () => {
    invoke.mockImplementation(async (cmd: string, args: { onProgress: { onmessage?: (m: unknown) => void } }) => {
      if (cmd === "logger_download_file") {
        args.onProgress.onmessage?.({ received: 1, total: 2 });
        return new Uint8Array([9, 8, 7]).buffer;
      }
      return undefined;
    });

    const onProgress = vi.fn();
    const result = await loggerDownloadFile("a_0217.dove", onProgress);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([9, 8, 7]);
    expect(onProgress).toHaveBeenCalledWith({ received: 1, total: 2 });
  });

  it("swallows errors on disconnect (safe when already gone)", async () => {
    invoke.mockRejectedValueOnce("boom");
    await expect(loggerDisconnect()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("logger_disconnect");
  });
});
