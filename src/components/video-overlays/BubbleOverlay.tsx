import { memo, useRef, useEffect } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { resolveValue, resolveRange } from "./dataSourceResolver";

interface BubbleOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const BubbleOverlay = memo(function BubbleOverlay({ instance, ctx, fontSize }: BubbleOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = getTheme(instance.theme);

  const valueX = resolveValue(instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const valueY = resolveValue(instance.dataSourceSecondary ?? instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const rangeX = resolveRange(instance.dataSource, ctx.samples, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const rangeY = resolveRange(instance.dataSourceSecondary ?? instance.dataSource, ctx.samples, ctx.dataSources, ctx.paceData, ctx.brakingGData);

  const size = Math.round(fontSize * 6);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const c = canvas.getContext("2d");
    if (!c) return;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size * 0.42;
    const midR = outerR * 0.5;

    // Background
    c.beginPath();
    c.arc(cx, cy, outerR + size * 0.04, 0, Math.PI * 2);
    c.fillStyle = theme.bg(instance.colorMode, instance.opacity);
    c.fill();
    c.strokeStyle = theme.border(instance.colorMode);
    c.lineWidth = 1;
    c.stroke();

    // Outer ring
    c.beginPath();
    c.arc(cx, cy, outerR, 0, Math.PI * 2);
    c.strokeStyle = theme.ringColor(instance.colorMode);
    c.lineWidth = 1.5;
    c.stroke();

    // Mid ring
    c.beginPath();
    c.arc(cx, cy, midR, 0, Math.PI * 2);
    c.strokeStyle = theme.ringColor(instance.colorMode);
    c.lineWidth = 1;
    c.stroke();

    // Crosshairs
    c.beginPath();
    c.moveTo(cx - outerR, cy);
    c.lineTo(cx + outerR, cy);
    c.moveTo(cx, cy - outerR);
    c.lineTo(cx, cy + outerR);
    c.strokeStyle = theme.ringColor(instance.colorMode);
    c.lineWidth = 0.5;
    c.stroke();

    // Center dot
    c.beginPath();
    c.arc(cx, cy, 3, 0, Math.PI * 2);
    c.fillStyle = theme.textSecondary(instance.colorMode);
    c.fill();

    // Data point
    if (valueX !== null && valueY !== null) {
      const xRange = Math.max(Math.abs(rangeX.min), Math.abs(rangeX.max)) || 1;
      const yRange = Math.max(Math.abs(rangeY.min), Math.abs(rangeY.max)) || 1;
      const px = cx + (valueX / xRange) * outerR * 0.9;
      const py = cy - (valueY / yRange) * outerR * 0.9; // inverted Y

      c.save();
      if (theme.glowFilter) {
        c.shadowColor = theme.accent(instance.colorMode);
        c.shadowBlur = 8;
      }
      c.beginPath();
      c.arc(px, py, size * 0.04, 0, Math.PI * 2);
      c.fillStyle = theme.accent(instance.colorMode);
      c.fill();
      c.restore();

      // Value labels
      const dispX = valueX.toFixed(2);
      const dispY = valueY.toFixed(2);
      c.fillStyle = theme.text(instance.colorMode);
      c.font = `bold ${size * 0.07}px "JetBrains Mono", monospace`;
      c.textAlign = "center";
      c.fillText(`${dispX} / ${dispY}`, cx, cy + outerR + size * 0.08);
    }
  }, [valueX, valueY, rangeX, rangeY, size, theme, instance.colorMode, instance.opacity]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, filter: theme.glowFilter }}
    />
  );
});
