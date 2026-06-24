import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoOff, Minus, Plus, Check } from 'lucide-react';
import type { VideoSyncState } from '@/hooks/useVideoSync';
import { usePlaybackContext } from '@/contexts/PlaybackContext';
import { coverageOf, sessionMsToVideoSec, type VideoCoverage } from '@/lib/videoTimeline';

/**
 * A second <video> for the split-graphs comparison panel, frame-locked to the
 * main player.
 *
 * It shares the main recording (same source + `syncOffsetMs`) but tracks the
 * overlay lap's own footage: mounted inside the secondary panel's overridden
 * PlaybackProvider, `currentSample` here is the overlay lap's sample at the
 * distance-matched cursor position, so both videos show the same point on track.
 *
 * Sync model: the main player is the master clock (its frame callback drives the
 * shared cursor). This element actively plays when the main does and trims its
 * own playbackRate to converge on the cursor-derived target — smooth motion that
 * stays locked even though the overlay lap advances at a different pace. Audio is
 * muted (the main owns sound). Where the overlay point has no footage the panel
 * blanks but the cursor keeps running.
 */
interface SecondaryVideoProps {
  videoState: VideoSyncState;
  /** The overlay lap this player follows; the manual nudge resets when it changes. */
  overlayId: string;
  /** In-session lap number (null for snap:/file: overlays — no rate calibration). */
  lapNumber: number | null;
  /** Commit the current nudge as a rate-calibration anchor for this lap. */
  onCommitRateAnchor?: (lap: number, sessionMs: number, videoSec: number) => void;
}

/** Fine-alignment step for the manual nudge, in milliseconds. */
const NUDGE_STEP_MS = 50;

export function SecondaryVideo({ videoState, overlayId, lapNumber, onCommitRateAnchor }: SecondaryVideoProps) {
  const { t } = useTranslation('session');
  const { currentSample } = usePlaybackContext();
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentSrcRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  // Manual fine-alignment, local to this comparison only — never written back to
  // the persisted main video sync. Reset whenever the overlay lap changes.
  const [nudgeMs, setNudgeMs] = useState(0);
  useEffect(() => setNudgeMs(0), [overlayId]);

  const { syncOffsetMs, syncRate, exportChunks, videoDuration, isPlaying } = videoState;

  const coverage: VideoCoverage = currentSample
    ? coverageOf(currentSample.t + nudgeMs / syncRate, syncOffsetMs, videoDuration, syncRate)
    : 'before';
  const covered = coverage === 'covered' && exportChunks.length > 0;

  // Resolve the target footage position (virtual time + chunk) for the cursor.
  // The rate-aware model converts session time → video time; `nudgeMs` is a
  // manual video-time shift on top (+ pushes the footage later).
  const target = useMemo(() => {
    if (!covered || !currentSample) return null;
    const virtualSec = sessionMsToVideoSec(currentSample.t, syncOffsetMs, syncRate) + nudgeMs / 1000;
    const chunk =
      exportChunks.find((c) => virtualSec >= c.startOffsetSec && virtualSec < c.startOffsetSec + c.durationSec) ??
      exportChunks[exportChunks.length - 1];
    return {
      virtualSec,
      chunkUrl: chunk.url,
      chunkStart: chunk.startOffsetSec,
      localSec: Math.max(0, virtualSec - chunk.startOffsetSec),
    };
  }, [covered, currentSample, syncOffsetMs, syncRate, exportChunks, nudgeMs]);

  // Commit the current nudge as a calibration anchor: the true (session ms ↔
  // video sec) correspondence the user just dialled in. The hook refits the
  // clock rate from this + the original sync (+ any other laps), so every lap
  // improves — then the local nudge resets to 0 since the model now accounts for it.
  const canCommit = nudgeMs !== 0 && lapNumber !== null && !!onCommitRateAnchor && !!currentSample && covered;
  const commit = () => {
    if (!canCommit || !currentSample || lapNumber === null) return;
    const achievedVideoSec = sessionMsToVideoSec(currentSample.t, syncOffsetMs, syncRate) + nudgeMs / 1000;
    onCommitRateAnchor!(lapNumber, currentSample.t, achievedVideoSec);
    setNudgeMs(0);
  };

  // The playback loop reads the latest target without re-subscribing per tick.
  const targetRef = useRef(target);
  targetRef.current = target;

  // Swap the <video> source when the cursor crosses a chunk boundary; defer the
  // seek until the new chunk's metadata loads.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !target) return;
    if (currentSrcRef.current !== target.chunkUrl) {
      currentSrcRef.current = target.chunkUrl;
      pendingSeekRef.current = target.localSec;
      video.src = target.chunkUrl;
      video.load();
    }
  }, [target?.chunkUrl, target?.localSec, target]);

  // Apply a deferred seek once a freshly-swapped chunk is ready.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onReady = () => {
      if (pendingSeekRef.current !== null) {
        try { video.currentTime = pendingSeekRef.current; } catch { /* retry next tick */ }
        pendingSeekRef.current = null;
      }
    };
    video.addEventListener('loadedmetadata', onReady);
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, []);

  // Paused / scrubbing: hold on the exact target frame.
  useEffect(() => {
    if (isPlaying) return;
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) video.pause();
    video.playbackRate = 1;
    if (target && currentSrcRef.current === target.chunkUrl && Math.abs(video.currentTime - target.localSec) > 0.05) {
      try { video.currentTime = target.localSec; } catch { /* not ready */ }
    }
  }, [isPlaying, target?.localSec, target?.chunkUrl, target]);

  // Playing: actively play and lock to the moving target. The target advances
  // non-linearly (overlay lap has its own pace), so trim playbackRate to
  // converge for smooth motion; hard-seek only on a big jump.
  useEffect(() => {
    const video = videoRef.current;
    if (!isPlaying || !covered || !video) {
      if (video && !video.paused) video.pause();
      if (video) video.playbackRate = 1;
      return;
    }
    video.play().catch(() => {});
    let raf = 0;
    let active = true;
    const loop = () => {
      if (!active) return;
      const v = videoRef.current;
      const tgt = targetRef.current;
      if (v && tgt && currentSrcRef.current === tgt.chunkUrl) {
        const elementVirtual = tgt.chunkStart + v.currentTime;
        const drift = elementVirtual - tgt.virtualSec; // >0 ahead, <0 behind
        if (Math.abs(drift) > 0.3) {
          try { v.currentTime = tgt.localSec; } catch { /* ignore */ }
          v.playbackRate = 1;
        } else {
          v.playbackRate = Math.max(0.5, Math.min(1.5, 1 - drift * 1.5));
        }
        if (v.paused) v.play().catch(() => {});
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      video.playbackRate = 1;
    };
  }, [isPlaying, covered]);

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" muted playsInline preload="auto" />
      {!covered && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground bg-black/70">
          <VideoOff className="h-6 w-6" />
          <span className="text-xs">
            {coverage === 'after' ? t('graphs.splitVideoEnded') : t('graphs.splitVideoStartsLater')}
          </span>
        </div>
      )}
      {covered && (
        <div
          className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-card/90 px-0.5 py-0.5 text-foreground backdrop-blur-sm"
          title={t('graphs.splitVideoNudgeTooltip')}
        >
          {syncRate !== 1 && (
            <span
              className="px-1 font-mono text-[10px] tabular-nums text-muted-foreground"
              title={t('graphs.splitVideoRateTooltip')}
            >
              {syncRate.toFixed(3)}×
            </span>
          )}
          <button
            type="button"
            aria-label={t('graphs.splitVideoNudgeEarlier')}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
            onClick={() => setNudgeMs((ms) => ms - NUDGE_STEP_MS)}
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="min-w-[3.25rem] px-1 text-center font-mono text-[11px] tabular-nums hover:text-primary"
            onClick={() => setNudgeMs(0)}
          >
            {nudgeMs > 0 ? '+' : ''}{(nudgeMs / 1000).toFixed(2)}s
          </button>
          <button
            type="button"
            aria-label={t('graphs.splitVideoNudgeLater')}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
            onClick={() => setNudgeMs((ms) => ms + NUDGE_STEP_MS)}
          >
            <Plus className="h-3 w-3" />
          </button>
          {canCommit && (
            <button
              type="button"
              aria-label={t('graphs.splitVideoCalibrate')}
              title={t('graphs.splitVideoCalibrate')}
              className="flex h-5 w-5 items-center justify-center rounded text-primary hover:bg-muted"
              onClick={commit}
            >
              <Check className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
