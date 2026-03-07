import { memo, useMemo } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { formatOverlayLapTime, getOverlayLapStartTime } from "./overlayUtils";

interface LapTimeOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

export const LapTimeOverlay = memo(function LapTimeOverlay({ instance, ctx, fontSize }: LapTimeOverlayProps) {
  const theme = getTheme(instance.theme);
  const showPace = instance.showPaceMode ?? false;

  // Current lap time
  const lapStartMs = getOverlayLapStartTime(ctx.samples, ctx.laps, ctx.selectedLapNumber);
  const currentTimeSec = lapStartMs != null ? (ctx.currentSample.t - lapStartMs) / 1000 : 0;
  const lapTimeDisplay = formatOverlayLapTime(Math.max(0, currentTimeSec));

  // Best lap info
  const bestLap = useMemo(() => {
    if (ctx.laps.length === 0) return null;
    let best = ctx.laps[0];
    for (const lap of ctx.laps) {
      if (lap.lapTimeMs < best.lapTimeMs) best = lap;
    }
    return best;
  }, [ctx.laps]);

  // Pace delta from paceData (distance-based, already computed)
  const paceValue = ctx.paceData[ctx.currentIndex] ?? null;

  const paceDisplay = paceValue !== null
    ? `${paceValue > 0 ? "+" : ""}${paceValue.toFixed(3)}s`
    : "—";
  const paceColor = paceValue !== null
    ? (paceValue < 0 ? "#22c55e" : paceValue > 0 ? "#ef4444" : theme.text(instance.colorMode))
    : theme.textSecondary(instance.colorMode);

  const bestTimeDisplay = bestLap ? formatOverlayLapTime(bestLap.lapTimeMs / 1000) : "—";

  return (
    <div
      style={{
        background: theme.bg(instance.colorMode, instance.opacity),
        borderRadius: fontSize * 0.25,
        padding: `${fontSize * 0.2}px ${fontSize * 0.4}px`,
        border: `1px solid ${theme.border(instance.colorMode)}`,
        backdropFilter: "blur(8px)",
        filter: theme.glowFilter,
        minWidth: showPace ? fontSize * 8 : undefined,
      }}
    >
      {/* Main lap time */}
      <div className="text-center font-mono font-bold" style={{
        fontSize: fontSize * 1.1,
        color: theme.text(instance.colorMode),
        lineHeight: 1.1,
      }}>
        {lapTimeDisplay}
      </div>

      {/* Label */}
      <div className="text-center font-mono" style={{
        fontSize: fontSize * 0.35,
        color: theme.textSecondary(instance.colorMode),
        letterSpacing: "0.05em",
        marginTop: fontSize * 0.05,
      }}>
        LAP TIME
      </div>

      {/* Pace mode: delta + best time */}
      {showPace && (
        <div
          className="flex items-center justify-between font-mono"
          style={{
            marginTop: fontSize * 0.15,
            borderTop: `1px solid ${theme.border(instance.colorMode)}`,
            paddingTop: fontSize * 0.15,
            gap: fontSize * 0.3,
          }}
        >
          {/* Pace delta (colored) */}
          <div className="text-center" style={{ flex: 1 }}>
            <div className="font-bold" style={{
              fontSize: fontSize * 0.6,
              color: paceColor,
            }}>
              {paceDisplay}
            </div>
            <div style={{
              fontSize: fontSize * 0.28,
              color: theme.textSecondary(instance.colorMode),
              letterSpacing: "0.05em",
            }}>
              DELTA
            </div>
          </div>

          {/* Best lap time */}
          <div className="text-center" style={{ flex: 1 }}>
            <div className="font-bold" style={{
              fontSize: fontSize * 0.6,
              color: theme.text(instance.colorMode),
            }}>
              {bestTimeDisplay}
            </div>
            <div style={{
              fontSize: fontSize * 0.28,
              color: theme.textSecondary(instance.colorMode),
              letterSpacing: "0.05em",
            }}>
              BEST {bestLap ? `L${bestLap.lapNumber}` : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
