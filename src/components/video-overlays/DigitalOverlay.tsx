import { memo, useMemo } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { resolveValue, resolveUnit } from "./dataSourceResolver";

interface DigitalOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const DigitalOverlay = memo(function DigitalOverlay({ instance, ctx, fontSize }: DigitalOverlayProps) {
  const theme = getTheme(instance.theme);
  const value = resolveValue(instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const unit = resolveUnit(instance.dataSource, ctx.dataSources);

  const displayValue = value !== null ? value.toFixed(1) : "—";

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
      <span className="font-mono" style={{ fontSize: fontSize * 0.55, marginLeft: fontSize * 0.15, color: theme.textSecondary(instance.colorMode) }}>{unit}</span>
    </div>
  );
});
