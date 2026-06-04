import { useCallback, useEffect, useRef, useState } from 'react';

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
 */
export function GraphResizeHandle({
  height,
  onResize,
  onCommit,
  min = GRAPH_MIN_HEIGHT,
  max = GRAPH_MAX_HEIGHT,
}: GraphResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startH = useRef(height);
  const latest = useRef(height);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const next = Math.max(min, Math.min(max, startH.current + (e.clientY - startY.current)));
    latest.current = next;
    onResize(next);
  }, [min, max, onResize]);

  const onPointerUp = useCallback(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    setDragging(false);
    onCommit(latest.current);
  }, [onPointerMove, onCommit]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    startY.current = e.clientY;
    startH.current = height;
    latest.current = height;
    setDragging(true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [height, onPointerMove, onPointerUp]);

  // Safety net: detach window listeners if we unmount mid-drag.
  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove, onPointerUp]);

  return (
    <div
      onPointerDown={onPointerDown}
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
