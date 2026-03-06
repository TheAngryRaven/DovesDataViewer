import { memo } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { resolveValue, resolveRange, resolveUnit } from "./dataSourceResolver";

interface BarOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const BarOverlay = memo(function BarOverlay({ instance, ctx, fontSize }: BarOverlayProps) {
  const theme = getTheme(instance.theme);
  const value = resolveValue(instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const { min, max } = resolveRange(instance.dataSource, ctx.samples, ctx.dataSources, ctx.paceData);
  const unit = resolveUnit(instance.dataSource, ctx.dataSources);

  const range = max - min || 1;
  const fraction = value !== null ? Math.max(0, Math.min(1, (value - min) / range)) : 0;
  const barColor = instance.color ?? theme.accent(instance.colorMode);
  const displayVal = value !== null ? value.toFixed(1) : "—";

  const barWidth = fontSize * 8;
  const barHeight = fontSize * 0.6;

  return (
    <div
      style={{
        background: theme.bg(instance.colorMode, instance.opacity),
        color: theme.text(instance.colorMode),
        borderRadius: fontSize * 0.2,
        padding: `${fontSize * 0.2}px ${fontSize * 0.3}px`,
        border: `1px solid ${theme.border(instance.colorMode)}`,
        backdropFilter: "blur(8px)",
        filter: theme.glowFilter,
        width: barWidth + fontSize * 0.6,
      }}
    >
      {/* Label row */}
      <div className="flex justify-between items-baseline" style={{ marginBottom: fontSize * 0.1 }}>
        <span className="font-mono font-bold" style={{ fontSize: fontSize * 0.7 }}>{displayVal}</span>
        <span className="font-mono" style={{ fontSize: fontSize * 0.45, color: theme.textSecondary(instance.colorMode) }}>{unit}</span>
      </div>
      {/* Bar */}
      <div
        style={{
          width: barWidth,
          height: barHeight,
          borderRadius: barHeight / 2,
          background: theme.ringColor(instance.colorMode),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${fraction * 100}%`,
            height: "100%",
            borderRadius: barHeight / 2,
            background: barColor,
            transition: "width 0.1s ease-out",
          }}
        />
      </div>
    </div>
  );
});
