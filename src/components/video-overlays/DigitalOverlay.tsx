import { memo } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { resolveValue, resolveUnit } from "./dataSourceResolver";

interface DigitalOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

function formatLapTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const whole = Math.floor(secs);
  const ms = Math.round((secs - whole) * 1000);
  if (mins > 0) {
    return `${mins}:${String(whole).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }
  return `${whole}.${String(ms).padStart(3, "0")}`;
}

function getLapStartTime(ctx: OverlayRenderContext): number | undefined {
  if (ctx.selectedLapNumber == null || ctx.laps.length === 0) {
    // Use first sample as fallback (session time)
    return ctx.samples.length > 0 ? ctx.samples[0].t : undefined;
  }
  const lap = ctx.laps.find((l) => l.lapNumber === ctx.selectedLapNumber);
  return lap?.startTime;
}

export const DigitalOverlay = memo(function DigitalOverlay({ instance, ctx, fontSize }: DigitalOverlayProps) {
  const theme = getTheme(instance.theme);
  const isLapTime = instance.dataSource === "__laptime__";
  const lapStartMs = isLapTime ? getLapStartTime(ctx) : undefined;
  const value = resolveValue(instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, lapStartMs);
  const unit = resolveUnit(instance.dataSource, ctx.dataSources);

  const displayValue = isLapTime
    ? (value !== null ? formatLapTime(value) : "0.000")
    : (value !== null ? value.toFixed(1) : "—");

  return (
    <div
      style={{
        background: theme.bg(instance.colorMode, instance.opacity),
        color: theme.text(instance.colorMode),
        borderRadius: fontSize * 0.2,
        padding: `${fontSize * 0.15}px ${fontSize * 0.3}px`,
        border: `1px solid ${theme.border(instance.colorMode)}`,
        backdropFilter: "blur(8px)",
        filter: theme.glowFilter,
      }}
    >
      <span className="font-mono font-bold" style={{ fontSize }}>{displayValue}</span>
      {unit && <span className="font-mono" style={{ fontSize: fontSize * 0.55, marginLeft: fontSize * 0.15, color: theme.textSecondary(instance.colorMode) }}>{unit}</span>}
    </div>
  );
});
