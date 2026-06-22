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

import { loggerConnect } from "./ipc";

// The kind-agnostic commands (list / download / disconnect) are covered by
// ../native/ipc.test.ts; this suite only asserts the MyChron-specific connect.
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
    await expect(loggerConnect()).rejects.toBe("device unreachable: not joined");
  });
});
