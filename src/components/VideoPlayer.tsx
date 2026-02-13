import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Lock, Unlock, Plus, Minus, Video, Crosshair, Volume2, VolumeX, RefreshCw, Sliders, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { GpsSample } from "@/types/racing";
import type { VideoSyncState, VideoSyncActions } from "@/hooks/useVideoSync";
import type { OverlayPosition } from "@/lib/videoStorage";

interface VideoPlayerProps {
  state: VideoSyncState;
  actions: VideoSyncActions;
  onLoadedMetadata: () => void;
  currentSample: GpsSample | null;
}

/** Base font size in px when video container is 640px wide */
const BASE_WIDTH = 640;
const BASE_FONT_PX = 18;

/** Draggable + resizable overlay wrapper */
function DraggableOverlay({
  id,
  position,
  locked,
  onMove,
  containerRef,
  children,
}: {
  id: string;
  position: OverlayPosition;
  locked: boolean;
  onMove: (id: string, pos: OverlayPosition) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  children: (scaledFontPx: number) => React.ReactNode;
}) {
  const [localPos, setLocalPos] = useState<OverlayPosition>(position);
  const [selected, setSelected] = useState(false);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const resizeStartY = useRef(0);
  const resizeStartScale = useRef(1);

  // Sync from prop when not interacting
  useEffect(() => {
    if (!dragging.current && !resizing.current) setLocalPos(position);
  }, [position]);

  // Deselect when locked
  useEffect(() => {
    if (locked) setSelected(false);
  }, [locked]);

  // Compute video-relative font size
  const [containerWidth, setContainerWidth] = useState(BASE_WIDTH);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width || BASE_WIDTH);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth || BASE_WIDTH);
    return () => ro.disconnect();
  }, [containerRef]);

  const scale = localPos.scale ?? 1;
  const scaledFontPx = (containerWidth / BASE_WIDTH) * BASE_FONT_PX * scale;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();

    // If not selected yet, just select
    if (!selected) {
      setSelected(true);
      return;
    }

    // Already selected — start drag
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    offset.current = {
      x: e.clientX - (rect.left + (localPos.x / 100) * rect.width),
      y: e.clientY - (rect.top + (localPos.y / 100) * rect.height),
    };
  }, [locked, selected, localPos, containerRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(90, ((e.clientX - offset.current.x - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(90, ((e.clientY - offset.current.y - rect.top) / rect.height) * 100));
    setLocalPos(prev => ({ ...prev, x, y }));
  }, [containerRef]);

  const handlePointerUp = useCallback(() => {
    if (dragging.current) {
      dragging.current = false;
      onMove(id, localPos);
    }
  }, [id, onMove, localPos]);

  // Resize handle
  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeStartY.current = e.clientY;
    resizeStartScale.current = localPos.scale ?? 1;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [localPos.scale]);

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    e.stopPropagation();
    // Dragging down = bigger, up = smaller
    const delta = e.clientY - resizeStartY.current;
    const newScale = Math.max(0.4, Math.min(4, resizeStartScale.current + delta / 100));
    setLocalPos(prev => ({ ...prev, scale: newScale }));
  }, []);

  const handleResizePointerUp = useCallback(() => {
    if (resizing.current) {
      resizing.current = false;
      onMove(id, localPos);
    }
  }, [id, onMove, localPos]);

  // Click outside deselects (via video area click)
  useEffect(() => {
    if (!selected || locked) return;
    const handleClick = (e: MouseEvent) => {
      const el = document.getElementById(`overlay-${id}`);
      if (el && !el.contains(e.target as Node)) {
        setSelected(false);
      }
    };
    // Delayed to avoid catching the selecting click
    const timer = setTimeout(() => document.addEventListener("pointerdown", handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleClick);
    };
  }, [selected, locked, id]);

  return (
    <div
      id={`overlay-${id}`}
      className={`absolute ${locked ? "pointer-events-none" : selected ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      style={{
        left: `${localPos.x}%`,
        top: `${localPos.y}%`,
        transform: "translate3d(0,0,0)",
        willChange: dragging.current || resizing.current ? "transform" : "auto",
        touchAction: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Selection ring */}
      {!locked && selected && (
        <div className="absolute inset-0 ring-2 ring-white/60 rounded-md pointer-events-none" style={{ margin: -2 }} />
      )}
      {/* Move hint when unlocked but not selected */}
      {!locked && !selected && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-white/40 rounded-full flex items-center justify-center pointer-events-none">
          <Move className="w-2 h-2 text-white" />
        </div>
      )}
      {children(scaledFontPx)}
      {/* Resize handle — bottom-right corner, only when selected */}
      {!locked && selected && (
        <div
          className="absolute -bottom-2 -right-2 w-5 h-5 bg-white/80 rounded-sm border border-white/40 cursor-ns-resize flex items-center justify-center"
          style={{ touchAction: "none" }}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M0 8L8 0M3 8L8 3M6 8L8 6" stroke="rgba(0,0,0,0.5)" strokeWidth="1" />
          </svg>
        </div>
      )}
    </div>
  );
}

export const VideoPlayer = memo(function VideoPlayer({ state, actions, onLoadedMetadata, currentSample }: VideoPlayerProps) {
  const { useKph } = useSettingsContext();
  const progressRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showOverlayDialog, setShowOverlayDialog] = useState(false);

  const speed = currentSample
    ? useKph ? currentSample.speedKph : currentSample.speedMph
    : null;
  const speedUnit = useKph ? "KPH" : "MPH";

  const overlaysLocked = state.overlaySettings.overlaysLocked ?? true;
  const positions = state.overlaySettings.positions ?? { speed: { x: 3, y: 3 } };

  const handleOverlayMove = useCallback((id: string, pos: OverlayPosition) => {
    actions.updateOverlaySettings({
      positions: { ...positions, [id]: pos },
    });
  }, [actions, positions]);

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
    if (toolbarRef.current?.contains(e.target as Node)) return;
    // Don't toggle if dragging overlays
    if (!overlaysLocked) return;
    setControlsVisible(v => !v);
    if (state.isPlaying) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, [state.isPlaying, overlaysLocked]);

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
      <div ref={videoAreaRef} className="flex-1 min-h-0 relative overflow-hidden" onClick={handleVideoClick}>
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

        {/* Draggable speed overlay */}
        {state.overlaySettings.showSpeed && speed !== null && !state.isOutOfRange && (
          <DraggableOverlay
            id="speed"
            position={positions.speed || { x: 3, y: 3 }}
            locked={overlaysLocked}
            onMove={handleOverlayMove}
            containerRef={videoAreaRef}
          >
            {(fontSize) => (
              <div className={`bg-black/60 backdrop-blur-sm rounded-md select-none ${!overlaysLocked ? "" : ""}`}
                style={{ padding: `${fontSize * 0.15}px ${fontSize * 0.3}px` }}
              >
                <span className="text-white font-mono font-bold" style={{ fontSize }}>{speed.toFixed(1)}</span>
                <span className="text-white/70 font-mono" style={{ fontSize: fontSize * 0.6, marginLeft: fontSize * 0.15 }}>{speedUnit}</span>
              </div>
            )}
          </DraggableOverlay>
        )}
      </div>

      {/* Overlay Settings Dialog */}
      <Dialog open={showOverlayDialog} onOpenChange={setShowOverlayDialog}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Sliders className="w-5 h-5" />
              Overlay Settings
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4 overflow-y-auto flex-1 min-h-0 pr-3 scrollbar-thin">
            {/* Data Overlays Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-medium">Data Overlays</h3>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Toggle which data values are shown on the video. Unlock overlays in the toolbar to drag them to your preferred position.
              </p>

              <div className="flex items-center justify-between pl-6">
                <div>
                  <Label htmlFor="overlay-speed" className="text-sm">Speed</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Current speed in {useKph ? "KPH" : "MPH"}
                  </p>
                </div>
                <Switch
                  id="overlay-speed"
                  checked={state.overlaySettings.showSpeed}
                  onCheckedChange={(checked) => actions.updateOverlaySettings({ showSpeed: checked })}
                />
              </div>
            </div>

            <Separator />

            {/* More sections will go here */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-medium">More Options</h3>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Additional overlay options coming soon — lap timer, G-force indicator, throttle position, and more.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

          {/* Overlay position lock */}
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 backdrop-blur-sm text-white ${!overlaysLocked ? "bg-amber-500/60 hover:bg-amber-500/40 active:bg-amber-500/30" : "bg-white/15 hover:bg-white/30 active:bg-white/25"}`}
            onClick={() => actions.updateOverlaySettings({ overlaysLocked: !overlaysLocked })}
            title={overlaysLocked ? "Unlock overlays to reposition" : "Lock overlay positions"}
          >
            {overlaysLocked ? <Lock className="w-3.5 h-3.5" /> : <Move className="w-3.5 h-3.5" />}
          </Button>

          {/* Overlay config */}
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 backdrop-blur-sm text-white ${showOverlayDialog ? "bg-white/30" : "bg-white/15"} hover:bg-white/30 active:bg-white/25`}
            onClick={() => setShowOverlayDialog(v => !v)}
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
