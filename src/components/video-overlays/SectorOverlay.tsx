import { memo, useMemo, useState, useEffect, useRef } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import type { Lap, SectorTimes } from "@/types/racing";

interface SectorOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

interface SectorState {
  delta: number | null;
  status: "outlap" | "first" | "best" | "slower";
  progress: number; // 0-1 for completion animation
}

export const SectorOverlay = memo(function SectorOverlay({ instance, ctx, fontSize }: SectorOverlayProps) {
  const theme = getTheme(instance.theme);
  const showAnimation = instance.showAnimation !== false;

  // Compute best sectors for this session
  const bestSectors = useMemo(() => {
    const best: { s1: number; s2: number; s3: number } = { s1: Infinity, s2: Infinity, s3: Infinity };
    for (const lap of ctx.laps) {
      if (!lap.sectors) continue;
      if (lap.sectors.s1 !== undefined && lap.sectors.s1 < best.s1) best.s1 = lap.sectors.s1;
      if (lap.sectors.s2 !== undefined && lap.sectors.s2 < best.s2) best.s2 = lap.sectors.s2;
      if (lap.sectors.s3 !== undefined && lap.sectors.s3 < best.s3) best.s3 = lap.sectors.s3;
    }
    return best;
  }, [ctx.laps]);

  // Find current lap
  const currentLap = useMemo(() => {
    if (ctx.selectedLapNumber !== null) {
      return ctx.laps.find(l => l.lapNumber === ctx.selectedLapNumber) ?? null;
    }
    // Find by current sample time
    const t = ctx.currentSample.t;
    for (const lap of ctx.laps) {
      if (t >= lap.startTime && t <= lap.endTime) return lap;
    }
    return null;
  }, [ctx.laps, ctx.selectedLapNumber, ctx.currentSample.t]);

  // Build sector states
  const sectors = useMemo((): SectorState[] => {
    const result: SectorState[] = [
      { delta: null, status: "outlap", progress: 0 },
      { delta: null, status: "outlap", progress: 0 },
      { delta: null, status: "outlap", progress: 0 },
    ];

    if (!currentLap?.sectors) return result;
    const s = currentLap.sectors;
    const keys: (keyof SectorTimes)[] = ["s1", "s2", "s3"];
    const bestKeys: (keyof typeof bestSectors)[] = ["s1", "s2", "s3"];
    const isFirstLap = currentLap.lapNumber === 1;

    for (let i = 0; i < 3; i++) {
      const val = s[keys[i]];
      const bestVal = bestSectors[bestKeys[i]];

      if (val === undefined || val === 0) {
        result[i] = { delta: null, status: "outlap", progress: 0 };
      } else if (isFirstLap && bestVal === val) {
        // First lap — green
        result[i] = { delta: 0, status: "first", progress: 1 };
      } else if (val <= bestVal) {
        result[i] = { delta: val - bestVal, status: "best", progress: 1 };
      } else {
        result[i] = { delta: val - bestVal, status: "slower", progress: 1 };
      }
    }
    return result;
  }, [currentLap, bestSectors]);

  // Track sector completion for animation
  const prevSectorsRef = useRef(sectors);
  const [animatingSector, setAnimatingSector] = useState<number | null>(null);

  useEffect(() => {
    if (!showAnimation) return;
    const prev = prevSectorsRef.current;
    for (let i = 0; i < 3; i++) {
      if (prev[i].status === "outlap" && sectors[i].status !== "outlap") {
        setAnimatingSector(i);
        const timer = setTimeout(() => setAnimatingSector(null), 1200);
        return () => clearTimeout(timer);
      }
    }
    prevSectorsRef.current = sectors;
  }, [sectors, showAnimation]);

  const getBgColor = (s: SectorState) => {
    switch (s.status) {
      case "best": return "rgba(168, 85, 247, 0.7)";   // purple
      case "slower": return "rgba(239, 68, 68, 0.7)";   // red
      case "first": return "rgba(34, 197, 94, 0.7)";    // green
      case "outlap": return "rgba(128, 128, 128, 0.25)"; // grey
    }
  };

  const formatDelta = (s: SectorState) => {
    if (s.delta === null) return "—";
    const sec = s.delta / 1000;
    return `${sec >= 0 ? "+" : ""}${sec.toFixed(3)}`;
  };

  return (
    <div
      className="flex gap-1"
      style={{
        filter: theme.glowFilter,
      }}
    >
      {sectors.map((s, i) => (
        <div
          key={i}
          className={`relative overflow-hidden font-mono font-bold text-center ${
            showAnimation && animatingSector === i && s.status === "best" ? "overlay-sparkle" : ""
          }`}
          style={{
            background: getBgColor(s),
            color: s.status === "outlap" ? theme.textSecondary(instance.colorMode) : "#ffffff",
            fontSize: fontSize * 0.65,
            padding: `${fontSize * 0.15}px ${fontSize * 0.3}px`,
            borderRadius: fontSize * 0.2,
            minWidth: fontSize * 3,
            backdropFilter: "blur(8px)",
            border: `1px solid ${s.status === "best" ? "rgba(168,85,247,0.4)" : "transparent"}`,
          }}
        >
          {/* Progress sweep animation */}
          {showAnimation && animatingSector === i && (
            <div
              className="absolute inset-0 overlay-sector-sweep"
              style={{ background: "rgba(255,255,255,0.2)", borderRadius: fontSize * 0.2 }}
            />
          )}
          <div className="relative z-10">
            <div style={{ fontSize: fontSize * 0.35, color: s.status === "outlap" ? "inherit" : "rgba(255,255,255,0.7)" }}>S{i + 1}</div>
            {formatDelta(s)}
          </div>
        </div>
      ))}
    </div>
  );
});
