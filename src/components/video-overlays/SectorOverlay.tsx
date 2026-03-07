import { memo, useMemo, useState, useEffect, useRef } from "react";
import type { OverlayInstance, OverlayRenderContext } from "./types";
import { getTheme } from "./themes";
import { computeBestSectors } from "./sectorUtils";
import { findCurrentLap } from "./overlayUtils";

interface SectorOverlayProps {
  instance: OverlayInstance;
  ctx: OverlayRenderContext;
  fontSize: number;
}

interface SectorState {
  delta: number | null;
  status: "outlap" | "first" | "best" | "slower" | "active";
  progress: number;
}

export const SectorOverlay = memo(function SectorOverlay({ instance, ctx, fontSize }: SectorOverlayProps) {
  const theme = getTheme(instance.theme);
  const showAnimation = instance.showAnimation !== false;

  // Compute best sectors across all laps
  const bestSectors = useMemo(() => computeBestSectors(ctx.laps), [ctx.laps]);

  // Find current lap
  const currentLap = useMemo(() =>
    findCurrentLap(ctx.laps, ctx.selectedLapNumber, ctx.currentSample.t),
    [ctx.laps, ctx.selectedLapNumber, ctx.currentSample.t]
  );

  // Build time-aware sector states based on cursor position
  const sectors = useMemo((): SectorState[] => {
    const blank: SectorState[] = [
      { delta: null, status: "outlap", progress: 0 },
      { delta: null, status: "outlap", progress: 0 },
      { delta: null, status: "outlap", progress: 0 },
    ];

    if (!currentLap?.sectors) return blank;
    const s = currentLap.sectors;
    const t = ctx.currentSample.t;
    const lapStart = currentLap.startTime;
    const isFirstLap = currentLap.lapNumber === 1;

    // Calculate absolute crossing times
    const s1Time = s.s1 !== undefined && s.s1 > 0 ? s.s1 : 0;
    const s2Time = s.s2 !== undefined && s.s2 > 0 ? s.s2 : 0;
    const s3Time = s.s3 !== undefined && s.s3 > 0 ? s.s3 : 0;

    const s2Crossing = s1Time > 0 ? lapStart + s1Time : Infinity;
    const s3Crossing = s2Time > 0 ? s2Crossing + s2Time : Infinity;
    const lapEnd = currentLap.endTime;

    const result: SectorState[] = [];

    // Sector 1
    if (t < s2Crossing && s1Time > 0) {
      result.push({ delta: null, status: "active", progress: 0 });
    } else if (s1Time > 0) {
      result.push(buildSectorResult(s1Time, bestSectors.s1, isFirstLap));
    } else {
      result.push({ delta: null, status: "outlap", progress: 0 });
    }

    // Sector 2
    if (t < s2Crossing) {
      result.push({ delta: null, status: "outlap", progress: 0 });
    } else if (t < s3Crossing && s2Time > 0) {
      result.push({ delta: null, status: "active", progress: 0 });
    } else if (s2Time > 0) {
      result.push(buildSectorResult(s2Time, bestSectors.s2, isFirstLap));
    } else {
      result.push({ delta: null, status: "outlap", progress: 0 });
    }

    // Sector 3
    if (t < s3Crossing) {
      result.push({ delta: null, status: "outlap", progress: 0 });
    } else if (t < lapEnd && s3Time > 0) {
      result.push({ delta: null, status: "active", progress: 0 });
    } else if (s3Time > 0) {
      result.push(buildSectorResult(s3Time, bestSectors.s3, isFirstLap));
    } else {
      result.push({ delta: null, status: "outlap", progress: 0 });
    }

    return result;
  }, [currentLap, bestSectors, ctx.currentSample.t]);

  // Track sector completion for sparkle animation
  const prevSectorsRef = useRef(sectors);
  const [animatingSector, setAnimatingSector] = useState<number | null>(null);

  useEffect(() => {
    if (!showAnimation) return;
    const prev = prevSectorsRef.current;
    for (let i = 0; i < 3; i++) {
      if ((prev[i].status === "outlap" || prev[i].status === "active") &&
          (sectors[i].status === "best" || sectors[i].status === "first" || sectors[i].status === "slower")) {
        setAnimatingSector(i);
        const timer = setTimeout(() => setAnimatingSector(null), 1200);
        prevSectorsRef.current = sectors;
        return () => clearTimeout(timer);
      }
    }
    prevSectorsRef.current = sectors;
  }, [sectors, showAnimation]);

  const getBgColor = (s: SectorState) => {
    switch (s.status) {
      case "best": return "rgba(168, 85, 247, 0.7)";
      case "slower": return "rgba(239, 68, 68, 0.7)";
      case "first": return "rgba(34, 197, 94, 0.7)";
      case "active": return "rgba(59, 130, 246, 0.5)";
      case "outlap": return "rgba(128, 128, 128, 0.25)";
    }
  };

  const formatDelta = (s: SectorState) => {
    if (s.status === "active") return "•••";
    if (s.delta === null) return "—";
    const sec = s.delta / 1000;
    return `${sec >= 0 ? "+" : ""}${sec.toFixed(3)}`;
  };

  return (
    <div className="flex gap-1" style={{ filter: theme.glowFilter }}>
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

function buildSectorResult(
  sectorTime: number,
  bestTime: number,
  isFirstLap: boolean,
): SectorState {
  if (isFirstLap && bestTime === sectorTime) {
    return { delta: 0, status: "first", progress: 1 };
  }
  if (sectorTime <= bestTime) {
    return { delta: sectorTime - bestTime, status: "best", progress: 1 };
  }
  return { delta: sectorTime - bestTime, status: "slower", progress: 1 };
}
