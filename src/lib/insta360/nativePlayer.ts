/**
 * The camera stream as a `<video>`-shaped object (plan 0025).
 *
 * `useVideoSync` and `VideoPlayer` drive playback through the subset of the
 * `HTMLVideoElement` API in [`VideoSurface`]: `currentTime`, `duration`,
 * `paused`, `play()/pause()`, the intrinsic size, and the `loadedmetadata` /
 * `play` / `pause` / `seeked` / `ended` events. A camera recording streamed
 * by the shell's native player has no DOM element behind it — its pixels are
 * an MJPEG `<img>` — so this adapter implements that same surface over the
 * `insta360_*` IPC and a player-event channel, and the sync code stays
 * source-agnostic.
 *
 * Time is served from a [`PlayerClock`] (extrapolated between native
 * reports) so reads are synchronous; seeks fire `seeked` when native confirms
 * or after a watchdog, so the scrub pacer can never wedge.
 */

import {
  insta360ClosePlayer,
  insta360OpenPlayer,
  insta360PlayerControl,
  insta360SetView,
} from "./ipc";
import { PlayerClock } from "./playerClock";
import type {
  Insta360CameraFile,
  Insta360PlayerEvent,
  Insta360PlayerInfo,
  Insta360PlayerRequest,
  ViewPose,
} from "./types";

/** The part of `HTMLVideoElement` the video-sync machinery relies on. */
export interface VideoSurface {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
  fastSeek?(time: number): void;
  requestVideoFrameCallback?(cb: (now: number, metadata: VideoFrameCallbackMetadata) => void): number;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export interface NativePlayerOptions {
  /** Preview frame size — the WebView's panel size in device pixels. */
  width: number;
  height: number;
  fps?: number;
  quality?: number;
  preferProxy?: boolean;
  muted?: boolean;
  /** Injectable for tests. */
  now?: () => number;
  open?: typeof insta360OpenPlayer;
  control?: typeof insta360PlayerControl;
  close?: typeof insta360ClosePlayer;
  setView?: typeof insta360SetView;
}

const SEEK_WATCHDOG_MS = 600;

/**
 * One native player session over one camera recording. `open()` starts the
 * stream; `close()` (or opening another) stops it. Extends `EventTarget` so
 * the sync hook's `addEventListener` calls work unchanged.
 */
export class NativePlayerElement extends EventTarget implements VideoSurface {
  readonly file: Insta360CameraFile;
  private readonly opts: Required<Pick<NativePlayerOptions, "width" | "height" | "fps" | "quality" | "preferProxy" | "muted">>;
  private readonly now: () => number;
  private readonly ipc: {
    open: typeof insta360OpenPlayer;
    control: typeof insta360PlayerControl;
    close: typeof insta360ClosePlayer;
    setView: typeof insta360SetView;
  };
  private readonly clock = new PlayerClock();
  private info: Insta360PlayerInfo | null = null;
  private closed = false;
  private mutedState: boolean;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSeek = false;
  /** Last pose the player confirmed (360° only). */
  pose: ViewPose | null = null;
  /** The shell's message for the last `error` event. */
  lastError: string | null = null;

  constructor(file: Insta360CameraFile, options: NativePlayerOptions) {
    super();
    this.file = file;
    this.opts = {
      width: options.width,
      height: options.height,
      fps: options.fps ?? 20,
      quality: options.quality ?? 70,
      preferProxy: options.preferProxy ?? true,
      muted: options.muted ?? true,
    };
    this.mutedState = this.opts.muted;
    this.now = options.now ?? (() => performance.now());
    this.ipc = {
      open: options.open ?? insta360OpenPlayer,
      control: options.control ?? insta360PlayerControl,
      close: options.close ?? insta360ClosePlayer,
      setView: options.setView ?? insta360SetView,
    };
    this.clock.setDuration(file.durationMs);
  }

  /** The MJPEG URL to show, once opened. */
  get streamUrl(): string | null {
    return this.info?.streamUrl ?? null;
  }

  get is360(): boolean {
    return this.info?.is360 ?? this.file.is360;
  }

  // ── VideoSurface ────────────────────────────────────────────────────────

  get currentTime(): number {
    return this.clock.positionAt(this.now()) / 1000;
  }

  set currentTime(sec: number) {
    this.seekTo(sec, true);
  }

  fastSeek(sec: number): void {
    this.seekTo(sec, false);
  }

  get duration(): number {
    return this.clock.duration / 1000;
  }

  get paused(): boolean {
    return !this.clock.isPlaying;
  }

  get videoWidth(): number {
    return this.info?.width ?? this.opts.width;
  }

  get videoHeight(): number {
    return this.info?.height ?? this.opts.height;
  }

  get muted(): boolean {
    return this.mutedState;
  }

  set muted(m: boolean) {
    if (this.mutedState === m) return;
    this.mutedState = m;
    if (this.info) void this.ipc.control({ action: "setMuted", muted: m }).catch(() => {});
  }

  async play(): Promise<void> {
    if (this.closed || !this.info) return;
    this.clock.setPlaying(true, this.now());
    this.dispatchEvent(new Event("play"));
    await this.ipc.control({ action: "play" });
  }

  pause(): void {
    if (this.closed || !this.info) return;
    this.clock.setPlaying(false, this.now());
    this.dispatchEvent(new Event("pause"));
    void this.ipc.control({ action: "pause" }).catch(() => {});
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** Start the stream. Resolves once the shell has the player prepared. */
  async open(): Promise<Insta360PlayerInfo> {
    const request: Insta360PlayerRequest = {
      urls: this.file.urls,
      is360: this.file.is360,
      preferProxy: this.opts.preferProxy,
      width: this.opts.width,
      height: this.opts.height,
      fps: this.opts.fps,
      quality: this.opts.quality,
      muted: this.opts.muted,
    };
    const info = await this.ipc.open(request, (e) => this.onEvent(e));
    if (this.closed) {
      void this.ipc.close();
      throw new Error("player closed while opening");
    }
    this.info = info;
    this.clock.setDuration(info.durationMs);
    // Metadata is known as soon as the player is prepared; a later `opened`
    // event may refine the duration (fired again then, harmlessly).
    this.dispatchEvent(new Event("loadedmetadata"));
    return info;
  }

  /** Stop the stream and release the native player (idempotent). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearSeekTimer();
    if (this.info) void this.ipc.close();
    this.info = null;
    this.clock.setPlaying(false, this.now());
  }

  /** Point the 360° view. Resolves to the pose the player reached. */
  async setViewPose(pose: ViewPose): Promise<ViewPose> {
    if (this.closed || !this.info) return pose;
    const reached = await this.ipc.setView(pose);
    this.pose = reached;
    return reached;
  }

  // ── internals ───────────────────────────────────────────────────────────

  private seekTo(sec: number, precise: boolean): void {
    if (this.closed || !this.info) return;
    const positionMs = Math.max(0, Math.round(sec * 1000));
    this.clock.seek(positionMs, this.now());
    this.pendingSeek = true;
    this.armSeekWatchdog();
    void this.ipc.control({ action: "seek", positionMs, precise }).catch(() => this.settleSeek());
  }

  private armSeekWatchdog(): void {
    this.clearSeekTimer();
    this.seekTimer = setTimeout(() => this.settleSeek(), SEEK_WATCHDOG_MS);
  }

  private clearSeekTimer(): void {
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
  }

  private settleSeek(): void {
    this.clearSeekTimer();
    if (!this.pendingSeek) return;
    this.pendingSeek = false;
    this.dispatchEvent(new Event("seeked"));
  }

  private onEvent(e: Insta360PlayerEvent): void {
    if (this.closed) return;
    const now = this.now();
    switch (e.kind) {
      case "opened":
        this.clock.report({ positionMs: e.positionMs, durationMs: e.durationMs, playing: e.playing }, now);
        this.dispatchEvent(new Event("loadedmetadata"));
        break;
      case "status": {
        // A seek in flight owns the position until it lands.
        if (!this.pendingSeek) {
          this.clock.report({ positionMs: e.positionMs, durationMs: e.durationMs, playing: e.playing }, now);
        } else {
          this.clock.setDuration(e.durationMs);
        }
        this.dispatchEvent(new Event("timeupdate"));
        break;
      }
      case "seeked":
        this.clock.report({ positionMs: e.positionMs, durationMs: e.durationMs, playing: e.playing }, now);
        this.settleSeek();
        break;
      case "ended":
        this.clock.report({ positionMs: e.positionMs, durationMs: e.durationMs, playing: false }, now);
        this.dispatchEvent(new Event("pause"));
        this.dispatchEvent(new Event("ended"));
        break;
      case "error":
        this.clock.setPlaying(false, now);
        this.lastError = e.message ?? "player error";
        this.dispatchEvent(new Event("error"));
        break;
      case "closed":
        this.closed = true;
        this.info = null;
        this.clearSeekTimer();
        break;
    }
  }
}
