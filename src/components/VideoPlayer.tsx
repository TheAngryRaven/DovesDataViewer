import { memo, useCallback, useRef, useState } from "react";
import { Play, Pause, Lock, Unlock, Plus, Minus, Video, Crosshair, Volume2, VolumeX, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [isMuted, setIsMuted] = useState(true);

  const speed = currentSample
    ? useKph ? currentSample.speedKph : currentSample.speedMph
    : null;
  const speedUnit = useKph ? "KPH" : "MPH";

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (state.isLocked || !progressRef.current || state.videoDuration <= 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    actions.seekVideo(fraction * state.videoDuration);
  }, [state.isLocked, state.videoDuration, actions]);

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
      {/* Video element */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
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

        {/* Speed overlay - upper left */}
        {speed !== null && (
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded-md px-3 py-1.5">
            <span className="text-white font-mono text-lg font-bold">{speed.toFixed(1)}</span>
            <span className="text-white/70 text-xs ml-1">{speedUnit}</span>
          </div>
        )}

        {/* Controls - upper right */}
        <div className="absolute top-3 right-3 flex items-center gap-1">
          {!state.isLocked && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-black/60 hover:bg-black/80 text-white"
                onClick={() => actions.stepFrame(-1)}
                title="Previous frame"
              >
                <Minus className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-black/60 hover:bg-black/80 text-white"
                onClick={() => actions.stepFrame(1)}
                title="Next frame"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 text-white ${state.isLocked ? "bg-primary/80 hover:bg-primary/60" : "bg-black/60 hover:bg-black/80"}`}
            onClick={actions.toggleLock}
            title={state.isLocked ? "Unlock sync" : "Lock sync"}
          >
            {state.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </Button>
        </div>

        {/* Set sync point button - bottom right above progress bar */}
        {!state.isLocked && (
          <div className="absolute bottom-12 right-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 bg-black/60 hover:bg-black/80 text-white text-xs gap-1.5"
              onClick={actions.setSyncPoint}
              title="Set sync point: aligns current video position with current telemetry cursor"
            >
              <Crosshair className="w-3.5 h-3.5" /> Set Sync
            </Button>
          </div>
        )}
      </div>

      {/* Bottom progress bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-black/90">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white hover:bg-white/20"
          onClick={actions.togglePlay}
        >
          {state.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white hover:bg-white/20"
          onClick={() => setIsMuted(m => !m)}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </Button>

        <div
          ref={progressRef}
          onClick={handleProgressClick}
          className={`flex-1 h-2 rounded-full overflow-hidden ${state.isLocked ? "bg-white/10 cursor-not-allowed" : "bg-white/20 cursor-pointer"}`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-75 ${state.isLocked ? "bg-primary/60" : "bg-primary"}`}
            style={{ width: `${progressFraction * 100}%` }}
          />
        </div>

        <span className="text-white/60 text-xs font-mono min-w-[80px] text-right">
          {formatTime(state.videoCurrentTime)} / {formatTime(state.videoDuration)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white hover:bg-white/20"
          onClick={actions.loadVideo}
          title="Replace video"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
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
