/**
 * A playhead the WebView can read synchronously — pure.
 *
 * The native player reports its position in bursts (~10 Hz while playing);
 * everything in the video-sync machinery expects `currentTime` to be
 * readable any time, like a `<video>`. The clock keeps the last report and
 * extrapolates while playing, clamped to the duration, and snaps on seeks.
 */

export interface PlayerReport {
  positionMs: number;
  durationMs: number;
  playing: boolean;
}

export class PlayerClock {
  private positionMs = 0;
  private durationMs = 0;
  private playing = false;
  private reportedAt = 0;

  /** Fold in a native report taken at `nowMs` (monotonic, e.g. performance.now()). */
  report(r: PlayerReport, nowMs: number): void {
    this.positionMs = Math.max(0, r.positionMs);
    if (r.durationMs > 0) this.durationMs = r.durationMs;
    this.playing = r.playing;
    this.reportedAt = nowMs;
  }

  /** The WebView asked for a seek; assume it lands until native says otherwise. */
  seek(positionMs: number, nowMs: number): void {
    this.positionMs = Math.max(0, positionMs);
    if (this.durationMs > 0) this.positionMs = Math.min(this.positionMs, this.durationMs);
    this.reportedAt = nowMs;
  }

  setPlaying(playing: boolean, nowMs: number): void {
    // Freeze the extrapolated position at the transition so pausing doesn't
    // jump back to the last report.
    this.positionMs = this.positionAt(nowMs);
    this.playing = playing;
    this.reportedAt = nowMs;
  }

  setDuration(durationMs: number): void {
    if (durationMs > 0) this.durationMs = durationMs;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get duration(): number {
    return this.durationMs;
  }

  /** Extrapolated position at `nowMs`, ms. */
  positionAt(nowMs: number): number {
    if (!this.playing) return this.positionMs;
    const p = this.positionMs + Math.max(0, nowMs - this.reportedAt);
    return this.durationMs > 0 ? Math.min(p, this.durationMs) : p;
  }
}
