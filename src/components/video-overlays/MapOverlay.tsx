import { memo, useRef, useEffect } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";

interface MapOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const MapOverlay = memo(function MapOverlay({ instance, ctx, fontSize }: MapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = getTheme(instance.theme);
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

    const samples = ctx.allSamples;
    if (samples.length < 2) return;

    const pad = size * 0.08;

    // Background
    c.beginPath();
    c.roundRect(0, 0, size, size, fontSize * 0.2);
    c.fillStyle = theme.bg(instance.colorMode, instance.opacity);
    c.fill();
    c.strokeStyle = theme.border(instance.colorMode);
    c.lineWidth = 1;
    c.stroke();

    // Compute bounds
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const s of samples) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lon < minLon) minLon = s.lon;
      if (s.lon > maxLon) maxLon = s.lon;
    }
    const latRange = maxLat - minLat || 0.001;
    const lonRange = maxLon - minLon || 0.001;
    const plotSize = size - pad * 2;

    // Maintain aspect ratio
    const scale = Math.min(plotSize / lonRange, plotSize / latRange);
    const offsetX = pad + (plotSize - lonRange * scale) / 2;
    const offsetY = pad + (plotSize - latRange * scale) / 2;

    const toX = (lon: number) => offsetX + (lon - minLon) * scale;
    const toY = (lat: number) => offsetY + (maxLat - lat) * scale;

    // Draw track line
    c.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = toX(samples[i].lon);
      const y = toY(samples[i].lat);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = theme.ringColor(instance.colorMode);
    c.lineWidth = 2;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke();

    // Current position dot
    const current = ctx.currentSample;
    if (current) {
      const px = toX(current.lon);
      const py = toY(current.lat);

      c.save();
      if (theme.glowFilter) {
        c.shadowColor = theme.accent(instance.colorMode);
        c.shadowBlur = 6;
      }
      c.beginPath();
      c.arc(px, py, size * 0.035, 0, Math.PI * 2);
      c.fillStyle = theme.accent(instance.colorMode);
      c.fill();
      c.restore();
    }
  }, [ctx.currentSample, ctx.allSamples, size, theme, instance.colorMode, instance.opacity, fontSize]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, filter: theme.glowFilter }}
    />
  );
});
