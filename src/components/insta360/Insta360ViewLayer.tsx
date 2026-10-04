import { useCallback, useEffect, useRef } from "react";
import type { NativePlayerElement } from "@/lib/insta360/nativePlayer";
import { dragToPose } from "@/lib/insta360/pose";
import { DEFAULT_VIEW_POSE, type ViewPose } from "@/lib/insta360/types";

interface Insta360ViewLayerProps {
  player: NativePlayerElement;
  /** The on-screen picture size (CSS px) — drag distances are scaled to it. */
  width: number;
  height: number;
  /** Locked: the layer is inert and touches fall through to the player UI. */
  locked: boolean;
}

/**
 * Drag-to-point for a 360° camera stream (plan 0025). The picture follows the
 * finger the way every 360° player behaves; each move becomes an absolute
 * pose the shell steers the native player to. Poses are sent one at a time —
 * a drag that outruns the bridge collapses to the latest pose, never a
 * queue. Pinch/zoom is deliberately not here yet.
 */
export function Insta360ViewLayer({ player, width, height, locked }: Insta360ViewLayerProps) {
  const poseRef = useRef<ViewPose>(player.pose ?? DEFAULT_VIEW_POSE);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const inflightRef = useRef(false);
  const pendingRef = useRef<ViewPose | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const flush = useCallback(() => {
    if (inflightRef.current) return;
    const next = pendingRef.current;
    if (!next) return;
    pendingRef.current = null;
    inflightRef.current = true;
    void player
      .setViewPose(next)
      .then((reached) => { poseRef.current = reached; })
      .catch(() => { /* the next drag re-sends; a closed player just ignores us */ })
      .finally(() => {
        inflightRef.current = false;
        if (aliveRef.current) flush();
      });
  }, [player]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    lastRef.current = { x: e.clientX, y: e.clientY };
    poseRef.current = player.pose ?? poseRef.current;
  }, [locked, player]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const last = lastRef.current;
    if (!last || locked) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    lastRef.current = { x: e.clientX, y: e.clientY };
    const next = dragToPose(pendingRef.current ?? poseRef.current, dx, dy, width, height);
    pendingRef.current = next;
    flush();
  }, [locked, width, height, flush]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!lastRef.current) return;
    lastRef.current = null;
    e.stopPropagation();
    flush();
  }, [flush]);

  if (locked) return null;
  return (
    <div
      className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
