import { useCallback, useRef, useState } from 'react';

/** Min/max pixel height a pro-mode graph can be dragged to. */
export const GRAPH_MIN_HEIGHT = 120;
export const GRAPH_MAX_HEIGHT = 800;

interface GraphResizeHandleProps {
  /** Current committed height (px) — the drag starts from here. */
  height: number;
  /** Live update on each drag move (transient, not persisted). */
  onResize: (height: number) => void;
  /** Fired once on pointer release with the final height (persist here). */
  onCommit: (height: number) => void;
  min?: number;
  max?: number;
}

/**
 * A slim drag bar pinned to the bottom of a graph card. Pointer-drag adjusts the
 * card's height; the parent owns the height value (so it can persist per session).
 * Shared by SingleSeriesChart + GGDiagram.
 *
 * Uses pointer capture so the drag keeps tracking even when the finger/cursor
 * leaves the slim handle — without it, mobile touches escape the 8px target and
 * the browser reclaims the gesture as a scroll (firing pointercancel), which is
 * why the drag would only move a few pixels at a time.
 */
export function GraphResizeHandle({
  height,
  onResize,
  onCommit,
  min = GRAPH_MIN_HEIGHT,
  max = GRAPH_MAX_HEIGHT,
}: GraphResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const startY = useRef(0);
  const startH = useRef(height);
  const latest = useRef(height);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startH.current = height;
    latest.current = height;
    draggingRef.current = true;
    setDragging(true);
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const next = Math.max(min, Math.min(max, startH.current + (e.clientY - startY.current)));
    latest.current = next;
    onResize(next);
  }, [min, max, onResize]);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    onCommit(latest.current);
  }, [onCommit]);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="group/handle shrink-0 h-2 flex items-center justify-center cursor-ns-resize z-20 touch-none"
      title="Drag to resize"
      role="separator"
      aria-orientation="horizontal"
    >
      <div
        className={`h-1 w-10 rounded-full transition-colors ${
          dragging ? 'bg-primary' : 'bg-border group-hover/handle:bg-primary/60'
        }`}
      />
    </div>
  );
}
