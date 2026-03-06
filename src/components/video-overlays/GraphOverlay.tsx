import { memo, useRef, useEffect } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { resolveValue, resolveRange, resolveUnit } from "./dataSourceResolver";

interface GraphOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const GraphOverlay = memo(function GraphOverlay({ instance, ctx, fontSize }: GraphOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>([]);
  const theme = getTheme(instance.theme);

  const value = resolveValue(instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const { min, max } = resolveRange(instance.dataSource, ctx.samples, ctx.dataSources, ctx.paceData);
  const unit = resolveUnit(instance.dataSource, ctx.dataSources);
  const graphLength = instance.graphLength ?? 100;
  const lineColor = instance.color ?? theme.accent(instance.colorMode);

  const width = Math.round(fontSize * 10);
  const height = Math.round(fontSize * 4);

  // Update history
  if (value !== null) {
    historyRef.current.push(value);
    if (historyRef.current.length > graphLength) {
      historyRef.current = historyRef.current.slice(-graphLength);
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const c = canvas.getContext("2d");
    if (!c) return;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, width, height);

    const pad = 4;

    // Background
    c.fillStyle = theme.bg(instance.colorMode, instance.opacity);
    c.beginPath();
    c.roundRect(0, 0, width, height, fontSize * 0.2);
    c.fill();
    c.strokeStyle = theme.border(instance.colorMode);
    c.lineWidth = 1;
    c.stroke();

    const history = historyRef.current;
    if (history.length < 2) return;

    const range = max - min || 1;
    const plotW = width - pad * 2;
    const plotH = height - pad * 2 - fontSize * 0.8;
    const plotTop = pad;

    // Grid lines
    c.strokeStyle = theme.ringColor(instance.colorMode);
    c.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = plotTop + (i / 4) * plotH;
      c.beginPath();
      c.moveTo(pad, y);
      c.lineTo(pad + plotW, y);
      c.stroke();
    }

    // Line
    c.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = pad + (i / (graphLength - 1)) * plotW;
      const y = plotTop + plotH - ((history[i] - min) / range) * plotH;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = lineColor;
    c.lineWidth = 2;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke();

    // Current value label
    const displayVal = value !== null ? `${value.toFixed(1)} ${unit}` : "—";
    c.fillStyle = theme.text(instance.colorMode);
    c.font = `bold ${fontSize * 0.6}px "JetBrains Mono", monospace`;
    c.textAlign = "right";
    c.textBaseline = "bottom";
    c.fillText(displayVal, width - pad, height - pad * 0.5);
  }, [value, min, max, width, height, fontSize, theme, instance.colorMode, instance.opacity, lineColor, unit, graphLength]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, filter: theme.glowFilter }}
    />
  );
});
