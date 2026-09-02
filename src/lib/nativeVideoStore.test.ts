import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  native: { value: true },
}));

vi.mock("@/lib/loggers/native/ipc", () => ({
  api: async () => ({ invoke: mocks.invoke, convertFileSrc: (p: string) => `asset://${p}` }),
}));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native.value }));

import {
  clearNativeVideoStore,
  getNativeStoredVideo,
  listNativeStoredVideos,
  removeNativeStoredVideo,
} from "./nativeVideoStore";

const entry = { key: "GX010001-abc", fileName: "GX010001.MP4", size: 1234, path: "/data/videos/GX010001-abc.mp4" };

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.native.value = true;
});

describe("getNativeStoredVideo", () => {
  it("maps the shell's path to a playable asset URL", async () => {
    mocks.invoke.mockResolvedValueOnce(entry);
    const got = await getNativeStoredVideo("s.dovex");
    expect(mocks.invoke).toHaveBeenCalledWith("video_store_get", { sessionFileName: "s.dovex" });
    expect(got).toMatchObject({ ...entry, url: "asset:///data/videos/GX010001-abc.mp4" });
  });

  it("is null off the native shell without touching the bridge", async () => {
    mocks.native.value = false;
    expect(await getNativeStoredVideo("s.dovex")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("listNativeStoredVideos", () => {
  it("returns the shell's listing", async () => {
    mocks.invoke.mockResolvedValueOnce([entry]);
    expect(await listNativeStoredVideos()).toEqual([entry]);
    expect(mocks.invoke).toHaveBeenCalledWith("video_store_list");
  });

  it("is null on a shell that predates the listing (unknown command), quietly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invoke.mockRejectedValueOnce(new Error("Command video_store_list not found"));
    expect(await listNativeStoredVideos()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is null on the desktop stub's sentinel and on unexpected errors (those are logged)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invoke.mockRejectedValueOnce("unsupported: native video export is not supported on this platform yet");
    expect(await listNativeStoredVideos()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    mocks.invoke.mockRejectedValueOnce(new Error("disk on fire"));
    expect(await listNativeStoredVideos()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("is null off the native shell", async () => {
    mocks.native.value = false;
    expect(await listNativeStoredVideos()).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("removeNativeStoredVideo / clearNativeVideoStore", () => {
  it("delete by key and report the bytes freed", async () => {
    mocks.invoke.mockResolvedValueOnce(1234);
    expect(await removeNativeStoredVideo("GX010001-abc")).toBe(1234);
    expect(mocks.invoke).toHaveBeenCalledWith("video_store_remove", { key: "GX010001-abc" });
  });

  it("clear everything and report the bytes freed", async () => {
    mocks.invoke.mockResolvedValueOnce(99);
    expect(await clearNativeVideoStore()).toBe(99);
    expect(mocks.invoke).toHaveBeenCalledWith("video_store_clear");
  });

  it("propagate failures — the caller is a button that must report them", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("invalid store key"));
    await expect(removeNativeStoredVideo("../x")).rejects.toThrow("invalid store key");
  });
});
