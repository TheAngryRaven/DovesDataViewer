import { memo, useRef, useEffect, useMemo } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { computeSectorSegments, SECTOR_COLORS } from "./sectorUtils";
import { courseHasSectors } from "@/types/racing";

interface MapOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const MapOverlay = memo(function MapOverlay({ instance, ctx, fontSize }: MapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = getTheme(instance.theme);
  const size = Math.round(fontSize * 6);

  const showSectors = instance.showSectors === true && courseHasSectors(ctx.course);

  // Find current lap
  const currentLap = useMemo(() => {
    if (ctx.selectedLapNumber !== null) {
      return ctx.laps.find(l => l.lapNumber === ctx.selectedLapNumber) ?? null;
    }
    const t = ctx.currentSample.t;
    for (const lap of ctx.laps) {
      if (t >= lap.startTime && t <= lap.endTime) return lap;
    }
    return null;
  }, [ctx.laps, ctx.selectedLapNumber, ctx.currentSample.t]);

  // Compute sector segments
  const sectorSegments = useMemo(() => {
    if (!showSectors) return null;
    return computeSectorSegments(ctx.allSamples, currentLap, ctx.currentSample.t, ctx.laps);
  }, [showSectors, ctx.allSamples, currentLap, ctx.currentSample.t, ctx.laps]);

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

    const samples = ctx.samples.length > 1 ? ctx.samples : ctx.allSamples;
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

    // Compute bounds from allSamples for consistent framing
    const allSmp = ctx.allSamples.length > 1 ? ctx.allSamples : samples;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const s of allSmp) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lon < minLon) minLon = s.lon;
      if (s.lon > maxLon) maxLon = s.lon;
    }
    const latRange = maxLat - minLat || 0.001;
    const lonRange = maxLon - minLon || 0.001;
    const plotSize = size - pad * 2;

    const scale = Math.min(plotSize / lonRange, plotSize / latRange);
    const offsetX = pad + (plotSize - lonRange * scale) / 2;
    const offsetY = pad + (plotSize - latRange * scale) / 2;

    const toX = (lon: number) => offsetX + (lon - minLon) * scale;
    const toY = (lat: number) => offsetY + (maxLat - lat) * scale;

    c.lineCap = "round";
    c.lineJoin = "round";

    if (showSectors && sectorSegments && sectorSegments.length === 3) {
      // Draw full track as faint base line
      c.beginPath();
      for (let i = 0; i < allSmp.length; i++) {
        const x = toX(allSmp[i].lon);
        const y = toY(allSmp[i].lat);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = theme.ringColor(instance.colorMode);
      c.lineWidth = 1.5;
      c.stroke();

      // Draw each sector segment with its color
      for (const seg of sectorSegments) {
        const startI = Math.max(0, seg.startIdx);
        const endI = Math.min(allSmp.length - 1, seg.endIdx);
        if (endI <= startI) continue;

        c.beginPath();
        for (let i = startI; i <= endI; i++) {
          const x = toX(allSmp[i].lon);
          const y = toY(allSmp[i].lat);
          if (i === startI) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.strokeStyle = SECTOR_COLORS[seg.status];
        c.lineWidth = 3;
        c.stroke();
      }
    } else {
      // Default: single-color track line
      c.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = toX(samples[i].lon);
        const y = toY(samples[i].lat);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = theme.ringColor(instance.colorMode);
      c.lineWidth = 2;
      c.stroke();
    }

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
  }, [ctx.currentSample, ctx.allSamples, ctx.samples, size, theme, instance.colorMode, instance.opacity, fontSize, showSectors, sectorSegments]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, filter: theme.glowFilter }}
    />
  );
});
