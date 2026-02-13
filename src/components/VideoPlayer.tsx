import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Lock, Unlock, Plus, Minus, Video, Crosshair, Volume2, VolumeX, RefreshCw, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { GpsSample } from "@/types/racing";
import type { VideoSyncState, VideoSyncActions } from "@/hooks/useVideoSync";

interface VideoPlayerProps {
  state: VideoSyncState;
  actions: VideoSyncActions;
  onLoadedMetadata: () => void;
  currentSample: GpsSample | null;
}

export const VideoPlayer = memo(function VideoPlayer({ state, actions, onLoadedMetadata, currentSample }: VideoPlayerProps) {
  const { useKph } = useSettingsContext();
  const progressRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showOverlaySettings, setShowOverlaySettings] = useState(false);

  const speed = currentSample
    ? useKph ? currentSample.speedKph : currentSample.speedMph
    : null;
  const speedUnit = useKph ? "KPH" : "MPH";

  // Auto-hide logic
  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
    if (state.isPlaying) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, [state.isPlaying]);

  useEffect(() => {
    if (state.isPlaying) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [state.isPlaying]);

  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    // Don't toggle if clicking the toolbar area
    if (toolbarRef.current?.contains(e.target as Node)) return;
    setControlsVisible(v => !v);
    if (state.isPlaying) {
      // Reset timer if showing
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, [state.isPlaying]);

  // Progress bar interaction
  const seekFromPointer = useCallback((clientX: number) => {
    if (state.isLocked || !progressRef.current || state.videoDuration <= 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    actions.seekVideo(fraction * state.videoDuration);
  }, [state.isLocked, state.videoDuration, actions]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (state.isLocked) return;
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX);
  }, [state.isLocked, seekFromPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    seekFromPointer(e.clientX);
  }, [isDragging, seekFromPointer]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const progressFraction = state.videoDuration > 0
    ? Math.max(0, Math.min(1, state.videoCurrentTime / state.videoDuration))
    : 0;

  // No video loaded
  if (!state.videoUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-muted/20 gap-4">
        <Video className="w-12 h-12 text-muted-foreground/50" />
        <p className="text-muted-foreground text-sm">No video loaded</p>
        <Button variant="outline" size="sm" onClick={actions.loadVideo} className="gap-2">
          <Video className="w-4 h-4" /> Load Video
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative bg-black">
      {/* Video element + click target */}
      <div className="flex-1 min-h-0 relative overflow-hidden" onClick={handleVideoClick}>
        <video
          ref={actions.videoRef}
          src={state.videoUrl}
          onLoadedMetadata={onLoadedMetadata}
          className="w-full h-full object-contain"
          playsInline
          preload="auto"
          muted={isMuted}
        />

        {/* Out of range overlay */}
        {state.isOutOfRange && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <p className="text-white/70 text-sm font-medium">No video for this portion</p>
          </div>
        )}

        {/* Speed overlay - upper left, conditional */}
        {state.overlaySettings.showSpeed && speed !== null && (
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded-md px-3 py-1.5 pointer-events-none">
            <span className="text-white font-mono text-lg font-bold">{speed.toFixed(1)}</span>
            <span className="text-white/70 text-xs ml-1">{speedUnit}</span>
          </div>
        )}
      </div>

      {/* Overlay Settings popup */}
      {showOverlaySettings && (
        <div
          className="absolute bottom-[88px] right-3 z-50 bg-black/80 backdrop-blur-md rounded-lg border border-white/10 p-3 min-w-[180px] shadow-xl"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-white/90 text-xs font-semibold uppercase tracking-wide mb-2">Overlays</p>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-white/70 text-sm cursor-pointer" htmlFor="overlay-speed">Speed</Label>
            <Switch
              id="overlay-speed"
              checked={state.overlaySettings.showSpeed}
              onCheckedChange={(checked) => actions.updateOverlaySettings({ showSpeed: checked })}
            />
          </div>
        </div>
      )}

      {/* Unified bottom toolbar + progress bar */}
      <div
        ref={toolbarRef}
        onPointerMove={resetHideTimer}
        onClick={e => e.stopPropagation()}
        className={`absolute bottom-0 left-0 right-0 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Toolbar row */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-black/70 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-white/15 backdrop-blur-sm text-white hover:bg-white/30 active:bg-white/25"
            onClick={actions.togglePlay}
          >
            {state.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-white/15 backdrop-blur-sm text-white hover:bg-white/30 active:bg-white/25"
            onClick={() => setIsMuted(m => !m)}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>

          <div className="w-px h-5 bg-white/20 mx-1" />

          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 backdrop-blur-sm text-white ${state.isLocked ? "bg-primary/70 hover:bg-primary/50 active:bg-primary/40" : "bg-white/15 hover:bg-white/30 active:bg-white/25"}`}
            onClick={actions.toggleLock}
            title={state.isLocked ? "Unlock sync" : "Lock sync"}
          >
            {state.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </Button>
          {!state.isLocked && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-white/15 backdrop-blur-sm text-white hover:bg-white/30 active:bg-white/25"
                onClick={() => actions.stepFrame(-1)}
                title="Previous frame"
              >
                <Minus className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-white/15 backdrop-blur-sm text-white hover:bg-white/30 active:bg-white/25"
                onClick={() => actions.stepFrame(1)}
                title="Next frame"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 bg-white/15 backdrop-blur-sm text-white hover:bg-white/30 active:bg-white/25 text-xs gap-1.5"
                onClick={actions.setSyncPoint}
                title="Set sync point: aligns current video position with current telemetry cursor"
              >
                <Crosshair className="w-3.5 h-3.5" /> Sync
              </Button>
            </>
          )}

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 backdrop-blur-sm text-white ${showOverlaySettings ? "bg-white/30" : "bg-white/15"} hover:bg-white/30 active:bg-white/25`}
            onClick={() => setShowOverlaySettings(v => !v)}
            title="Overlay settings"
          >
            <Sliders className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Progress bar row */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-black/70 backdrop-blur-sm">
          <div
            ref={progressRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`flex-1 h-2 rounded-full overflow-hidden touch-none ${state.isLocked ? "bg-white/10 cursor-not-allowed" : "bg-white/20 cursor-pointer"}`}
          >
            <div
              className={`h-full rounded-full ${state.isLocked ? "bg-primary/60" : "bg-primary"}`}
              style={{ width: `${progressFraction * 100}%` }}
            />
          </div>

          <span className="text-white/60 text-xs font-mono min-w-[80px] text-right">
            {formatTime(state.videoCurrentTime)} / {formatTime(state.videoDuration)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-white/15 backdrop-blur-sm text-white hover:bg-white/30 active:bg-white/25"
            onClick={actions.loadVideo}
            title="Replace video"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
});

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
