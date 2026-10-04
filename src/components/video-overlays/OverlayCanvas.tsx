import { memo, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import {
  drawOverlayInstance,
  measureOverlay,
  type GraphHistories,
  type OverlayLabels,
} from "@/lib/overlayCanvasRenderer";
import { prepare2dCanvas } from "@/lib/canvas2d";

interface OverlayCanvasProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

/**
 * The one preview host for every overlay type (plan 0023). It owns a canvas
 * sized by measureOverlay() and hands the actual drawing to the same
 * per-type draw functions the export pipeline uses — the preview IS the
 * export renderer, so the two can no longer drift.
 *
 * The only preview-side extras are CSS on the canvas element itself: the
 * theme glow filter, and — for the boxy widgets that were previously
 * backdrop-blurred DOM — a backdrop blur with a matching border radius.
 * Neither exists in an exported file (there is no page behind it to blur),
 * which was equally true before unification.
 */
export const OverlayCanvas = memo(function OverlayCanvas({ instance, ctx, fontSize }: OverlayCanvasProps) {
  const { t } = useTranslation("video");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Graph overlays accumulate a rolling value history across frames.
  const historiesRef = useRef<GraphHistories>(new Map());
  const theme = getTheme(instance.theme);

  const labels = useMemo<OverlayLabels>(() => ({
    slow: t("widgets.slow"),
    fast: t("widgets.fast"),
    lapTime: t("widgets.lapTime"),
    delta: t("widgets.delta"),
    best: (lapLabel: string) => t("widgets.best", { lap: lapLabel }),
  }), [t]);

  const { w, h } = measureOverlay(instance, ctx, fontSize);

  // Redraw after every render: the render context is rebuilt per playback
  // tick, and memo() already limits renders to actual prop changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const c = prepare2dCanvas(canvas, w, h, dpr);
    if (!c) return;
    c.clearRect(0, 0, w, h);
    drawOverlayInstance(c, instance, ctx, { x: 0, y: 0, fontSize }, historiesRef.current, labels);
  });

  // The widgets that used to be backdrop-blurred DOM boxes keep the blur on
  // the (box-sized) canvas element; round the element to match the drawn box.
  const boxy = instance.type === "digital" || instance.type === "bar"
    || instance.type === "pace" || instance.type === "laptime";

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: w,
        height: h,
        filter: theme.glowFilter,
        ...(boxy
          ? {
              backdropFilter: "blur(8px)",
              borderRadius: fontSize * (instance.type === "laptime" ? 0.25 : 0.2),
            }
          : {}),
      }}
    />
  );
});
