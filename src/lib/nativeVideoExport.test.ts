/**
 * The native export bridge (plan 0024): IPC sequencing, the stale stored-copy
 * retry, and which `video_export_begin` failures mean "fall back to the
 * WebView exporter" versus "report an error". The shell, the base64 encoder
 * and the overlay renderer are mocked — this pins the bridge's own logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  native: { value: true },
  render: vi.fn(),
  channels: [] as Array<{ onmessage?: (p: { fraction: number }) => void }>,
}));

vi.mock("@/lib/loggers/native/ipc", () => ({
  api: async () => ({
    invoke: mocks.invoke,
    Channel: class {
      onmessage?: (p: { fraction: number }) => void;
      constructor() {
        mocks.channels.push(this);
      }
    },
  }),
}));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native.value }));
// Tiny chunks so a 10-byte source exercises the chunked upload loop.
vi.mock("@/lib/nativeBytes", () => ({
  NATIVE_CHUNK_BYTES: 4,
  blobToBase64: async (b: Blob) => `b64:${b.size}`,
}));
vi.mock("@/lib/overlayCanvasRenderer", () => ({
  renderOverlaysToCanvas: mocks.render,
  DEFAULT_OVERLAY_LABELS: {},
}));

import { startNativeVideoExport } from "./nativeVideoExport";
import type { ExportCallbacks, ExportContext, ExportSource } from "@/lib/videoExport";
import type { ExportOptions } from "@/components/video-overlays/VideoExportDialog";
import type { OverlayInstance, OverlayRenderContext } from "@/components/video-overlays/types";

const SOURCE_BYTES = "0123456789"; // 10 bytes → chunks at 0, 4, 8

function makeSource(over: Partial<ExportSource> = {}): ExportSource {
  return {
    liveVideo: { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement,
    chunks: [{ url: "blob:video", startOffsetSec: 0, durationSec: 10 }],
    totalDuration: 10,
    fileName: "GX010001.MP4",
    ...over,
  };
}

function makeOptions(over: Partial<ExportOptions> = {}): ExportOptions {
  return { includeOverlays: false, quality: "high", range: "full", destination: "app", ...over };
}

const noOverlays: ExportContext = { overlays: [], buildRenderCtx: () => null };

/** Callbacks + a promise that settles on the first terminal callback. */
function makeCallbacks(withGallery = false) {
  let settle!: (v: { kind: string; value: unknown }) => void;
  const done = new Promise<{ kind: string; value: unknown }>((r) => (settle = r));
  const progress: number[] = [];
  const callbacks: ExportCallbacks = {
    onProgress: (f) => progress.push(f),
    onComplete: (blob) => settle({ kind: "complete", value: blob }),
    onError: (e) => settle({ kind: "error", value: e }),
    ...(withGallery ? { onSavedToDevice: (uri: string) => settle({ kind: "saved", value: uri }) } : {}),
  };
  return { callbacks, done, progress };
}

/** Default shell: every command succeeds. */
function happyShell(overrides: Record<string, (args: unknown) => unknown> = {}) {
  mocks.invoke.mockImplementation(async (cmd: string, args: unknown) => {
    if (overrides[cmd]) return overrides[cmd](args);
    switch (cmd) {
      case "video_export_begin":
        return "job-1";
      case "video_export_run": {
        const ch = (args as { onProgress: { onmessage?: (p: { fraction: number }) => void } }).onProgress;
        ch.onmessage?.({ fraction: 0.5 });
        ch.onmessage?.({ fraction: 1 });
        return undefined;
      }
      case "video_export_collect":
        return new Uint8Array([1, 2, 3]).buffer;
      case "video_export_save":
        return "content://media/42";
      default:
        return undefined;
    }
  });
}

const commands = () => mocks.invoke.mock.calls.map((c) => c[0] as string);
const waitForDispose = () =>
  vi.waitFor(() => expect(commands()).toContain("video_export_dispose"));

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.render.mockReset();
  mocks.channels.length = 0;
  mocks.native.value = true;
  vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob([SOURCE_BYTES]) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startNativeVideoExport — when it declines", () => {
  it("returns null off the native shell without touching the bridge", async () => {
    mocks.native.value = false;
    const { callbacks } = makeCallbacks();
    expect(await startNativeVideoExport(makeSource(), noOverlays, makeOptions(), callbacks)).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("returns null for multi-chunk playlists and unknown dimensions", async () => {
    const { callbacks } = makeCallbacks();
    const twoChunks = makeSource({
      chunks: [
        { url: "a", startOffsetSec: 0, durationSec: 5 },
        { url: "b", startOffsetSec: 5, durationSec: 5 },
      ],
    });
    expect(await startNativeVideoExport(twoChunks, noOverlays, makeOptions(), callbacks)).toBeNull();
    const noDims = makeSource({ liveVideo: { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement });
    expect(await startNativeVideoExport(noDims, noOverlays, makeOptions(), callbacks)).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("startNativeVideoExport — begin failure classifier", () => {
  it.each([
    ["the desktop stub's sentinel", "unsupported: native video export is not supported on this platform yet"],
    ["a shell predating the command", new Error("Command video_export_begin not found")],
    ["an unknown command", "unknown command video_export_begin"],
    ["a command the capability doesn't allow", "video_export_begin not allowed"],
  ])("falls back (null) on %s", async (_label, err) => {
    mocks.invoke.mockRejectedValueOnce(err);
    const { callbacks } = makeCallbacks();
    const onError = vi.spyOn(callbacks, "onError");
    expect(await startNativeVideoExport(makeSource(), noOverlays, makeOptions(), callbacks)).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a real failure instead of silently falling back", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("disk full"));
    const { callbacks, done } = makeCallbacks();
    const ctrl = await startNativeVideoExport(makeSource(), noOverlays, makeOptions(), callbacks);
    expect(ctrl).not.toBeNull();
    expect(await done).toEqual({ kind: "error", value: "Error: disk full" });
    expect(commands()).toEqual(["video_export_begin"]);
  });
});

describe("startNativeVideoExport — sequencing", () => {
  it("uploads the source in chunks, transcodes, collects, then disposes", async () => {
    happyShell();
    const { callbacks, done, progress } = makeCallbacks();
    await startNativeVideoExport(makeSource(), noOverlays, makeOptions({ startTime: 1, endTime: 4 }), callbacks);
    const result = await done;
    await waitForDispose();

    expect(result.kind).toBe("complete");
    expect((result.value as Blob).type).toBe("video/mp4");
    expect(commands()).toEqual([
      "video_export_begin",
      "video_export_push_source",
      "video_export_push_source",
      "video_export_push_source",
      "video_export_run",
      "video_export_collect",
      "video_export_dispose",
    ]);
    // Begin carries the trim + quality mapping (high keeps source size).
    expect(mocks.invoke.mock.calls[0][1]).toEqual({
      params: { width: 1920, height: 1080, bitrate: 15_000_000, startMs: 1000, endMs: 4000 },
    });
    expect(mocks.invoke.mock.calls.slice(1, 4).map((c) => c[1])).toEqual([
      { jobId: "job-1", offset: 0, data: "b64:4" },
      { jobId: "job-1", offset: 4, data: "b64:4" },
      { jobId: "job-1", offset: 8, data: "b64:2" },
    ]);
    // Staging fills the first 35%, the transcode channel the rest, monotonically.
    expect(progress.at(-1)).toBeCloseTo(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it("scales a 'standard' export to 720p with even dimensions", async () => {
    happyShell();
    const { callbacks, done } = makeCallbacks();
    const source = makeSource({ liveVideo: { videoWidth: 1919, videoHeight: 1081 } as HTMLVideoElement });
    await startNativeVideoExport(source, noOverlays, makeOptions({ quality: "standard" }), callbacks);
    await done;
    const params = (mocks.invoke.mock.calls[0][1] as { params: Record<string, number> }).params;
    expect(params.height).toBe(720);
    expect(params.width % 2).toBe(0);
    expect(params.bitrate).toBe(5_000_000);
  });

  it("saves straight to the gallery when the caller asks for the device", async () => {
    happyShell();
    const { callbacks, done } = makeCallbacks(true);
    await startNativeVideoExport(makeSource(), noOverlays, makeOptions({ destination: "device" }), callbacks);
    expect(await done).toEqual({ kind: "saved", value: "content://media/42" });
    await waitForDispose();
    expect(commands()).not.toContain("video_export_collect");
    const save = mocks.invoke.mock.calls.find((c) => c[0] === "video_export_save");
    expect(save?.[1]).toEqual({ jobId: "job-1", fileName: "GX010001-overlay.mp4" });
  });

  it("renders overlay layers at 15 Hz through the shared renderer", async () => {
    happyShell();
    const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(["png"])));
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect: vi.fn() }), toBlob }),
    });
    const ctx: ExportContext = {
      overlays: [{ id: "o1" } as OverlayInstance],
      buildRenderCtx: () => ({}) as OverlayRenderContext,
    };
    const { callbacks, done } = makeCallbacks();
    await startNativeVideoExport(makeSource(), ctx, makeOptions({ includeOverlays: true, startTime: 0, endTime: 1 }), callbacks);
    await done;
    const layers = mocks.invoke.mock.calls.filter((c) => c[0] === "video_export_push_overlay");
    expect(layers).toHaveLength(15);
    expect(mocks.render).toHaveBeenCalledTimes(15);
    expect(layers[1][1]).toEqual({ jobId: "job-1", tMs: 67, data: "b64:3" });
  });

  it("reports a mid-job failure and still disposes the job", async () => {
    happyShell({
      video_export_run: () => {
        throw new Error("codec init failed");
      },
    });
    const { callbacks, done } = makeCallbacks();
    await startNativeVideoExport(makeSource(), noOverlays, makeOptions(), callbacks);
    expect(await done).toEqual({ kind: "error", value: "Error: codec init failed" });
    await waitForDispose();
  });

  it("cancel stops staging, tells the shell, and reports no error", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    happyShell({ video_export_push_source: () => gate });
    const { callbacks } = makeCallbacks();
    const onError = vi.spyOn(callbacks, "onError");
    const ctrl = await startNativeVideoExport(makeSource(), noOverlays, makeOptions(), callbacks);
    await vi.waitFor(() => expect(commands()).toContain("video_export_push_source"));
    ctrl!.cancel();
    release();
    await waitForDispose();
    expect(commands()).toContain("video_export_cancel");
    expect(commands().filter((c) => c === "video_export_push_source")).toHaveLength(1);
    expect(commands()).not.toContain("video_export_run");
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("startNativeVideoExport — stored source (stale-key retry)", () => {
  it("uses the shell's stored copy and skips the upload", async () => {
    happyShell();
    const { callbacks, done } = makeCallbacks();
    await startNativeVideoExport(makeSource({ nativeSourceKey: "GX-abc" }), noOverlays, makeOptions(), callbacks);
    await done;
    expect((mocks.invoke.mock.calls[0][1] as { params: { sourceKey?: string } }).params.sourceKey).toBe("GX-abc");
    expect(commands()).not.toContain("video_export_push_source");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries without the key when the stored copy is gone, then uploads", async () => {
    let begins = 0;
    happyShell({
      video_export_begin: () => {
        begins++;
        if (begins === 1) throw new Error("no stored video for key GX-abc");
        return "job-2";
      },
    });
    const { callbacks, done } = makeCallbacks();
    await startNativeVideoExport(makeSource({ nativeSourceKey: "GX-abc" }), noOverlays, makeOptions(), callbacks);
    expect((await done).kind).toBe("complete");
    const beginCalls = mocks.invoke.mock.calls.filter((c) => c[0] === "video_export_begin");
    expect(beginCalls).toHaveLength(2);
    expect((beginCalls[1][1] as { params: { sourceKey?: string } }).params.sourceKey).toBeUndefined();
    expect(commands()).toContain("video_export_push_source");
  });

  it("does not retry when the stored-source begin says the shell can't export at all", async () => {
    mocks.invoke.mockRejectedValueOnce("unsupported: not on this platform");
    const { callbacks } = makeCallbacks();
    expect(
      await startNativeVideoExport(makeSource({ nativeSourceKey: "GX-abc" }), noOverlays, makeOptions(), callbacks),
    ).toBeNull();
    expect(commands()).toEqual(["video_export_begin"]);
  });

  it("reports an error when the retry itself fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("no stored video")).mockRejectedValueOnce(new Error("disk full"));
    const { callbacks, done } = makeCallbacks();
    await startNativeVideoExport(makeSource({ nativeSourceKey: "GX-abc" }), noOverlays, makeOptions(), callbacks);
    expect(await done).toEqual({ kind: "error", value: "Error: disk full" });
  });
});
