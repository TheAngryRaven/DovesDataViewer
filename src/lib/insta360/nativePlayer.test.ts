import { describe, it, expect, vi } from "vitest";
import { NativePlayerElement } from "./nativePlayer";
import type { Insta360CameraFile, Insta360PlayerEvent, Insta360PlayerInfo } from "./types";

const file: Insta360CameraFile = {
  id: "abc",
  name: "VID_20240315_101500_00_012",
  urls: ["http://192.168.42.1/DCIM/Camera01/VID_20240315_101500_00_012.insv"],
  lrvUrls: ["http://192.168.42.1/DCIM/Camera01/LRV_20240315_101500_01_012.lrv"],
  is360: true,
  durationMs: 30_000,
  width: 5760,
  height: 2880,
  size: 1,
  segmentCount: 1,
  createdAtMs: 0,
};

function harness(overrides: Partial<Insta360PlayerInfo> = {}) {
  let clock = 1000;
  let emit: ((e: Insta360PlayerEvent) => void) | null = null;
  const control = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const setView = vi.fn(async (p) => ({ ...p, yaw: p.yaw + 0.05 }));
  const info: Insta360PlayerInfo = {
    streamUrl: "http://127.0.0.1:4321/stream/tok",
    width: 1280,
    height: 720,
    durationMs: 30_000,
    is360: true,
    ...overrides,
  };
  const open = vi.fn(async (_req, onEvent) => {
    emit = onEvent;
    return info;
  });
  const player = new NativePlayerElement(file, {
    width: 1280,
    height: 720,
    now: () => clock,
    open,
    control,
    close,
    setView,
  });
  return {
    player,
    control,
    close,
    setView,
    open,
    tick: (ms: number) => {
      clock += ms;
    },
    emit: (e: Insta360PlayerEvent) => emit?.(e),
  };
}

describe("NativePlayerElement", () => {
  it("opens with the request built from the file and reports metadata", async () => {
    const h = harness();
    const meta = vi.fn();
    h.player.addEventListener("loadedmetadata", meta);
    const info = await h.player.open();
    expect(info.streamUrl).toContain("127.0.0.1");
    expect(h.open).toHaveBeenCalledWith(
      expect.objectContaining({ urls: file.urls, is360: true, preferProxy: true, width: 1280, height: 720, muted: true }),
      expect.any(Function),
    );
    expect(meta).toHaveBeenCalledTimes(1);
    expect(h.player.streamUrl).toBe(info.streamUrl);
    expect(h.player.videoWidth).toBe(1280);
    expect(h.player.duration).toBe(30);
    expect(h.player.paused).toBe(true);
    expect(h.player.is360).toBe(true);
  });

  it("play/pause drive the shell and the extrapolated clock", async () => {
    const h = harness();
    await h.player.open();
    const events: string[] = [];
    for (const t of ["play", "pause"]) h.player.addEventListener(t, () => events.push(t));
    await h.player.play();
    expect(h.control).toHaveBeenLastCalledWith({ action: "play" });
    expect(h.player.paused).toBe(false);
    h.tick(500);
    expect(h.player.currentTime).toBeCloseTo(0.5, 6);
    h.player.pause();
    expect(h.control).toHaveBeenLastCalledWith({ action: "pause" });
    h.tick(5000);
    expect(h.player.currentTime).toBeCloseTo(0.5, 6);
    expect(events).toEqual(["play", "pause"]);
  });

  it("native status reports resync the clock", async () => {
    const h = harness();
    await h.player.open();
    await h.player.play();
    h.tick(100);
    h.emit({ kind: "status", positionMs: 4000, durationMs: 31_000, playing: true });
    h.tick(250);
    expect(h.player.currentTime).toBeCloseTo(4.25, 6);
    expect(h.player.duration).toBe(31);
  });

  it("seeks snap the clock, hold off status reports, and fire seeked on confirmation", async () => {
    const h = harness();
    await h.player.open();
    const seeked = vi.fn();
    h.player.addEventListener("seeked", seeked);
    h.player.currentTime = 12;
    expect(h.control).toHaveBeenLastCalledWith({ action: "seek", positionMs: 12_000, precise: true });
    expect(h.player.currentTime).toBe(12);
    h.emit({ kind: "status", positionMs: 3000, durationMs: 30_000, playing: false });
    expect(h.player.currentTime).toBe(12);
    h.emit({ kind: "seeked", positionMs: 12_010, durationMs: 30_000, playing: false });
    expect(seeked).toHaveBeenCalledTimes(1);
    expect(h.player.currentTime).toBeCloseTo(12.01, 6);
    h.player.fastSeek(3);
    expect(h.control).toHaveBeenLastCalledWith({ action: "seek", positionMs: 3000, precise: false });
  });

  it("a seek the shell never confirms still settles via the watchdog", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.player.open();
      const seeked = vi.fn();
      h.player.addEventListener("seeked", seeked);
      h.player.currentTime = 1;
      vi.advanceTimersByTime(700);
      expect(seeked).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ended pauses and fires ended; error fires error", async () => {
    const h = harness();
    await h.player.open();
    await h.player.play();
    const seen: string[] = [];
    for (const t of ["pause", "ended", "error"]) h.player.addEventListener(t, () => seen.push(t));
    h.emit({ kind: "ended", positionMs: 30_000, durationMs: 30_000, playing: false });
    expect(h.player.paused).toBe(true);
    expect(h.player.currentTime).toBe(30);
    h.emit({ kind: "error", positionMs: 0, durationMs: 0, playing: false, message: "boom" });
    expect(seen).toEqual(["pause", "ended", "error"]);
    expect(h.player.lastError).toBe("boom");
  });

  it("muted toggles reach the shell only after open, and only on change", async () => {
    const h = harness();
    h.player.muted = false;
    expect(h.control).not.toHaveBeenCalled();
    await h.player.open();
    h.player.muted = false;
    expect(h.control).not.toHaveBeenCalled();
    h.player.muted = true;
    expect(h.control).toHaveBeenLastCalledWith({ action: "setMuted", muted: true });
  });

  it("setViewPose records the pose the player reached", async () => {
    const h = harness();
    await h.player.open();
    const reached = await h.player.setViewPose({ yaw: 10, pitch: 0, fov: 90 });
    expect(reached.yaw).toBeCloseTo(10.05, 6);
    expect(h.player.pose).toEqual(reached);
  });

  it("close releases the native player once and ignores later events", async () => {
    const h = harness();
    await h.player.open();
    h.player.close();
    h.player.close();
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.player.streamUrl).toBeNull();
    h.emit({ kind: "status", positionMs: 9000, durationMs: 30_000, playing: true });
    expect(h.player.currentTime).toBe(0);
    await h.player.play();
    expect(h.control).not.toHaveBeenCalledWith({ action: "play" });
  });

  it("a player closed while opening releases the shell's player", async () => {
    let resolveOpen: ((i: Insta360PlayerInfo) => void) | null = null;
    const close = vi.fn(async () => {});
    const player = new NativePlayerElement(file, {
      width: 640,
      height: 360,
      open: () => new Promise((res) => { resolveOpen = res; }),
      control: async () => {},
      close,
      setView: async (p) => p,
    });
    const opening = player.open();
    player.close();
    resolveOpen!({ streamUrl: "u", width: 640, height: 360, durationMs: 1, is360: false });
    await expect(opening).rejects.toThrow(/closed/);
    expect(close).toHaveBeenCalled();
  });
});
