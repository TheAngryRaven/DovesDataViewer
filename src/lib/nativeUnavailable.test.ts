import { describe, it, expect } from "vitest";
import { isNativeFeatureUnavailable } from "./nativeUnavailable";

describe("isNativeFeatureUnavailable", () => {
  it("accepts the shell's unsupported: sentinel, as a string or an Error", () => {
    expect(isNativeFeatureUnavailable("unsupported: native video export is not supported on this platform yet")).toBe(true);
    expect(isNativeFeatureUnavailable(new Error("unsupported: no Insta360 SDK in this build"))).toBe(true);
  });

  it("accepts Tauri's missing-command and ACL rejections from an older shell", () => {
    expect(isNativeFeatureUnavailable("Command video_export_begin not found")).toBe(true);
    expect(isNativeFeatureUnavailable(new Error("Command video_store_list not found"))).toBe(true);
    expect(isNativeFeatureUnavailable("unknown command insta360_sdk_info")).toBe(true);
    expect(isNativeFeatureUnavailable("insta360_player_open not allowed. Permissions associated with this command: none")).toBe(true);
  });

  it("rejects errors from a command that ran — those must be reported", () => {
    for (const msg of [
      "no stored video for key abc",
      "file not found",
      "unknown error",
      "camera not found on the network",
      "device unreachable: not found",
      "storage write is not allowed while recording",
      "transcode failed: unsupported: codec", // the sentinel only counts as a prefix
    ]) {
      expect(isNativeFeatureUnavailable(msg), msg).toBe(false);
    }
  });
});
