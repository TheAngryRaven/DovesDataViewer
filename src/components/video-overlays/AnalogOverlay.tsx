import { memo, useRef, useEffect } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { resolveValue, resolveRange, resolveUnit } from "./dataSourceResolver";

interface AnalogOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

const START_ANGLE = Math.PI * 0.8; // ~144°
const END_ANGLE = Math.PI * 2.2;   // ~396° — total sweep ~252°
const SWEEP = END_ANGLE - START_ANGLE;

export const AnalogOverlay = memo(function AnalogOverlay({ instance, ctx, fontSize }: AnalogOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = getTheme(instance.theme);

  const value = resolveValue(instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const { min, max } = resolveRange(instance.dataSource, ctx.samples, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const unit = resolveUnit(instance.dataSource, ctx.dataSources);

  const size = Math.round(fontSize * 5);

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
    const r = size * 0.4;

    // Background circle
    c.beginPath();
    c.arc(cx, cy, r + size * 0.08, 0, Math.PI * 2);
    c.fillStyle = theme.bg(instance.colorMode, instance.opacity);
    c.fill();
    c.strokeStyle = theme.border(instance.colorMode);
    c.lineWidth = 1;
    c.stroke();

    // Track arc
    c.beginPath();
    c.arc(cx, cy, r, START_ANGLE, END_ANGLE);
    c.strokeStyle = theme.ringColor(instance.colorMode);
    c.lineWidth = size * 0.04;
    c.lineCap = "round";
    c.stroke();

    // Tick marks
    const numTicks = 10;
    for (let i = 0; i <= numTicks; i++) {
      const angle = START_ANGLE + (i / numTicks) * SWEEP;
      const isMajor = i % 5 === 0;
      const innerR = r - (isMajor ? size * 0.1 : size * 0.06);
      c.beginPath();
      c.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      c.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      c.strokeStyle = theme.textSecondary(instance.colorMode);
      c.lineWidth = isMajor ? 2 : 1;
      c.stroke();
    }

    // Needle
    if (value !== null) {
      const range = max - min || 1;
      const fraction = Math.max(0, Math.min(1, (value - min) / range));
      const needleAngle = START_ANGLE + fraction * SWEEP;
      const needleLen = r * 0.85;

      c.save();
      if (theme.glowFilter) {
        c.shadowColor = theme.needleColor(instance.colorMode);
        c.shadowBlur = 6;
      }
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(needleAngle) * needleLen, cy + Math.sin(needleAngle) * needleLen);
      c.strokeStyle = theme.needleColor(instance.colorMode);
      c.lineWidth = size * 0.025;
      c.lineCap = "round";
      c.stroke();
      c.restore();

      // Center dot
      c.beginPath();
      c.arc(cx, cy, size * 0.03, 0, Math.PI * 2);
      c.fillStyle = theme.needleColor(instance.colorMode);
      c.fill();
    }

    // Value text
    const displayVal = value !== null ? value.toFixed(1) : "—";
    c.fillStyle = theme.text(instance.colorMode);
    c.font = `bold ${size * 0.14}px "JetBrains Mono", monospace`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(displayVal, cx, cy + r * 0.35);

    // Unit text
    c.fillStyle = theme.textSecondary(instance.colorMode);
    c.font = `${size * 0.08}px "JetBrains Mono", monospace`;
    c.fillText(unit, cx, cy + r * 0.55);
  }, [value, min, max, size, theme, instance.colorMode, instance.opacity, unit]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, filter: theme.glowFilter }}
    />
  );
});
