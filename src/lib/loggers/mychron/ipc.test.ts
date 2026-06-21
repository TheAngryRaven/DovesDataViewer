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

import { loggerConnect, loggerListFiles, loggerDownloadFile, loggerDisconnect } from "./ipc";

describe("mychron ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects with the mychron kind, default host and the wifi hint", async () => {
    invoke.mockResolvedValue({ kind: "mychron", fields: {} });
    await loggerConnect({ wifi: { ssidPrefix: "MYCHRON5" } });
    expect(invoke).toHaveBeenCalledWith("logger_connect", {
      kind: "mychron",
      host: "10.0.0.1",
      wifi: { ssidPrefix: "MYCHRON5" },
    });
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
    const result = await loggerDownloadFile("a_0217.xrz", onProgress);

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
