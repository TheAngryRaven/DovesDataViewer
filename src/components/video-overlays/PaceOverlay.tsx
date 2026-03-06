import { memo, useMemo } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";

interface PaceOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const PaceOverlay = memo(function PaceOverlay({ instance, ctx, fontSize }: PaceOverlayProps) {
  const theme = getTheme(instance.theme);

  const paceValue = ctx.paceData[ctx.currentIndex] ?? null;

  // Determine range for the bar
  const maxDelta = useMemo(() => {
    let absMax = 0.5;
    for (const v of ctx.paceData) {
      if (Math.abs(v) > absMax) absMax = Math.abs(v);
    }
    return Math.min(absMax * 1.2, 5);
  }, [ctx.paceData]);

  const barWidth = fontSize * 10;
  const barHeight = fontSize * 0.7;
  const fraction = paceValue !== null ? Math.max(-1, Math.min(1, paceValue / maxDelta)) : 0;
  const displayVal = paceValue !== null ? `${paceValue > 0 ? "+" : ""}${paceValue.toFixed(3)}s` : "—";

  // Colors: green = faster (negative pace = ahead), red = slower
  const isGood = paceValue !== null && paceValue < 0;
  const isBad = paceValue !== null && paceValue > 0;

  return (
    <div
      style={{
        background: theme.bg(instance.colorMode, instance.opacity),
        borderRadius: fontSize * 0.2,
        padding: `${fontSize * 0.2}px ${fontSize * 0.3}px`,
        border: `1px solid ${theme.border(instance.colorMode)}`,
        backdropFilter: "blur(8px)",
        filter: theme.glowFilter,
        width: barWidth + fontSize * 0.6,
      }}
    >
      {/* Value label */}
      <div className="text-center font-mono font-bold" style={{
        fontSize: fontSize * 0.65,
        color: isGood ? "#22c55e" : isBad ? "#ef4444" : theme.text(instance.colorMode),
        marginBottom: fontSize * 0.1,
      }}>
        {displayVal}
      </div>
      {/* Bar with center zero */}
      <div
        style={{
          width: barWidth,
          height: barHeight,
          borderRadius: barHeight / 2,
          background: theme.ringColor(instance.colorMode),
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Center line */}
        <div style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 2,
          background: theme.textSecondary(instance.colorMode),
          transform: "translateX(-1px)",
          zIndex: 2,
        }} />
        {/* Fill */}
        {paceValue !== null && (
          <div style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            // Negative pace (ahead) fills right from center, positive fills left
            left: fraction < 0 ? `${50 + fraction * 50}%` : "50%",
            width: `${Math.abs(fraction) * 50}%`,
            background: isGood ? "#22c55e" : "#ef4444",
            borderRadius: barHeight / 2,
            transition: "left 0.1s, width 0.1s",
          }} />
        )}
      </div>
      {/* Labels */}
      <div className="flex justify-between font-mono" style={{
        fontSize: fontSize * 0.35,
        color: theme.textSecondary(instance.colorMode),
        marginTop: fontSize * 0.05,
      }}>
        <span>SLOW</span>
        <span>FAST</span>
      </div>
    </div>
  );
});
