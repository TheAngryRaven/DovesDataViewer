import { useRef, useEffect, useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { GpsSample } from '@/types/racing';
import { computeSmoothingWindowSize } from '@/lib/chartUtils';
import { pickGForcePair, computeGGPoints, computeGGAxisMax } from '@/lib/ggDiagram';
import { alignValuesByDistance } from '@/lib/referenceUtils';
import type { OverlayLine } from '@/lib/lapOverlays';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { getChartColors } from '@/lib/chartColors';
import { GraphResizeHandle } from './GraphResizeHandle';

/** Default height (px) for the G-G diagram card. */
export const GG_DEFAULT_HEIGHT = 240;

interface GGDiagramProps {
  samples: GpsSample[];
  referenceSamples?: GpsSample[];
  /** Selected multi-lap overlays — an alternative comparison cloud (toggle). */
  overlayLines?: OverlayLine[];
  currentIndex: number;
  label: string;
  onDelete: () => void;
  /** Committed card height (px); defaults to GG_DEFAULT_HEIGHT. */
  height?: number;
  /** Persist a new card height (fired on resize-drag release). */
  onHeightChange?: (height: number) => void;
}

type CompareMode = 'ref' | 'overlays';
type BoxAxis = 'lat' | 'lon';

const SESSION_COLOR = 'hsl(180, 70%, 55%)'; // cyan cloud (matches speed series)
const CURRENT_COLOR = 'hsl(0, 75%, 55%)';   // red current point

export function GGDiagram({ samples, referenceSamples, overlayLines = [], currentIndex, label, onDelete, height, onHeightChange }: GGDiagramProps) {
  const { gForceSmoothing, gForceSmoothingStrength, gForceSource, darkMode } = useSettingsContext();
  const chartColors = useMemo(() => getChartColors(darkMode), [darkMode]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Live card height — driven by the resize handle, seeded from the committed prop.
  const committedHeight = height ?? GG_DEFAULT_HEIGHT;
  const [cardHeight, setCardHeight] = useState(committedHeight);
  useEffect(() => { setCardHeight(committedHeight); }, [committedHeight]);

  const hasReference = !!referenceSamples && referenceSamples.length > 0;
  const hasOverlays = overlayLines.length > 0;

  // Which comparison cloud to draw beneath the session. Falls back to whichever
  // source is present; the header toggle only shows when both exist.
  const [compareMode, setCompareMode] = useState<CompareMode>('ref');
  const activeMode: CompareMode = compareMode === 'overlays' && !hasOverlays
    ? 'ref'
    : compareMode === 'ref' && !hasReference && hasOverlays
      ? 'overlays'
      : compareMode;

  const smoothingWindow = useMemo(
    () => computeSmoothingWindowSize(gForceSmoothing, gForceSmoothingStrength),
    [gForceSmoothing, gForceSmoothingStrength],
  );

  const pair = useMemo(() => pickGForcePair(samples, gForceSource), [samples, gForceSource]);

  const sessionPoints = useMemo(
    () => (pair ? computeGGPoints(samples, pair, smoothingWindow) : []),
    [samples, pair, smoothingWindow],
  );
  const refPoints = useMemo(
    () => (pair && hasReference
      ? computeGGPoints(referenceSamples!, pair, smoothingWindow)
      : []),
    [referenceSamples, hasReference, pair, smoothingWindow],
  );
  // One cloud per selected overlay lap, each drawn in its own line color.
  const overlayClouds = useMemo(
    () => (pair
      ? overlayLines.map((line) => ({
          color: line.color,
          points: computeGGPoints(line.samples, pair, smoothingWindow),
        }))
      : []),
    [overlayLines, pair, smoothingWindow],
  );

  const axisMax = useMemo(
    () => computeGGAxisMax(
      sessionPoints,
      ...(activeMode === 'overlays' ? overlayClouds.map((c) => c.points) : [refPoints]),
    ),
    [sessionPoints, refPoints, overlayClouds, activeMode],
  );

  // Which axis the readout box lists. Lateral by default — showing both lat and
  // lon for every cloud gets noisy fast, so the box toggles between them.
  const [boxAxis, setBoxAxis] = useState<BoxAxis>('lat');

  // Per-cloud readout rows for the info box: the session plus the active
  // comparison set, each carrying lat/lon series aligned to the current lap so a
  // single scrub index reads the same track position across every cloud.
  const boxRows = useMemo(() => {
    if (!pair || sessionPoints.length === 0) return [];
    const rows: { color: string; label: string; lat: (number | null)[]; lon: (number | null)[] }[] = [
      {
        color: SESSION_COLOR,
        label: 'Session',
        lat: sessionPoints.map((p) => (p ? p.x : null)),
        lon: sessionPoints.map((p) => (p ? p.y : null)),
      },
    ];
    if (activeMode === 'overlays') {
      overlayLines.forEach((line, i) => {
        const pts = overlayClouds[i]?.points ?? [];
        rows.push({
          color: line.color,
          label: line.label,
          lat: alignValuesByDistance(samples, line.samples, pts.map((p) => (p ? p.x : null))),
          lon: alignValuesByDistance(samples, line.samples, pts.map((p) => (p ? p.y : null))),
        });
      });
    } else if (hasReference) {
      rows.push({
        color: chartColors.refLine,
        label: 'Reference',
        lat: alignValuesByDistance(samples, referenceSamples!, refPoints.map((p) => (p ? p.x : null))),
        lon: alignValuesByDistance(samples, referenceSamples!, refPoints.map((p) => (p ? p.y : null))),
      });
    }
    return rows;
  }, [pair, sessionPoints, activeMode, overlayLines, overlayClouds, hasReference, referenceSamples, refPoints, samples, chartColors.refLine]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = chartColors.background;
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Square plot region, centred, leaving a margin for ring labels.
    const margin = 18;
    const size = Math.max(0, Math.min(dimensions.width, dimensions.height) - margin * 2);
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const R = size / 2;
    if (R <= 0) return;
    const scale = R / axisMax; // px per g

    // Map a (lat, lon) g point to screen — positive lon_g (accel) points up.
    const sx = (gx: number) => cx + gx * scale;
    const sy = (gy: number) => cy - gy * scale;

    if (!pair || sessionPoints.length === 0) {
      ctx.fillStyle = chartColors.axisText;
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No G-force data', cx, cy);
      return;
    }

    // Concentric grip rings at every 0.5 g, labelled.
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let g = 0.5; g <= axisMax + 1e-6; g += 0.5) {
      ctx.beginPath();
      ctx.strokeStyle = chartColors.grid;
      ctx.lineWidth = 1;
      ctx.arc(cx, cy, g * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = chartColors.axisText;
      ctx.fillText(g.toFixed(1), cx, cy - g * scale);
    }

    // Centre crosshair (zero axes).
    ctx.beginPath();
    ctx.strokeStyle = chartColors.zeroLine;
    ctx.lineWidth = 1;
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // Axis hint labels.
    ctx.fillStyle = chartColors.axisText;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('ACCEL', cx, cy - R - margin + 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText('BRAKE', cx, cy + R + margin - 2);
    // Lateral hint, anchored just inside the right end of the x-axis.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('LAT', cx + R - 2, cy - 2);

    // Helper: draw a cloud as cheap 1.5px squares.
    const drawCloud = (points: typeof sessionPoints, color: string, alpha: number) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      for (const p of points) {
        if (!p) continue;
        ctx.fillRect(sx(p.x) - 0.75, sy(p.y) - 0.75, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    };

    if (activeMode === 'overlays') {
      for (const cloud of overlayClouds) drawCloud(cloud.points, cloud.color, 0.5);
    } else {
      drawCloud(refPoints, chartColors.refLine, 0.5);
    }
    drawCloud(sessionPoints, SESSION_COLOR, 0.45);

    // Current point (its numeric readout lives in the HTML info box below).
    const cur = sessionPoints[currentIndex];
    if (cur) {
      ctx.beginPath();
      ctx.fillStyle = CURRENT_COLOR;
      ctx.arc(sx(cur.x), sy(cur.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Source badge, bottom-left.
    ctx.fillStyle = chartColors.axisText;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(pair.source, 4, dimensions.height - 4);
  }, [dimensions, sessionPoints, refPoints, overlayClouds, activeMode, axisMax, currentIndex, pair, chartColors]);

  return (
    <div className="relative border-b border-border flex flex-col" style={{ height: `${cardHeight}px` }}>
      <div className="absolute top-1 left-2 z-10 flex items-center gap-1.5 pointer-events-none">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SESSION_COLOR }} />
        <span className="text-xs font-mono text-muted-foreground">{label}</span>
      </div>
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 z-10 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        title="Remove graph"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div ref={containerRef} className="flex-1 w-full min-h-0 overflow-hidden">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>

      {/* Bottom-right: comparison/axis toggles above a per-cloud value readout. */}
      {boxRows.length > 0 && (
        <div className="absolute bottom-2 right-2 z-10 flex flex-col items-end gap-1">
          <div className="flex gap-1">
            {hasReference && hasOverlays && (
              <button
                onClick={() => setCompareMode(activeMode === 'overlays' ? 'ref' : 'overlays')}
                className="px-1.5 py-0.5 rounded border border-border bg-background/80 text-[10px] font-mono text-muted-foreground hover:bg-muted/50 transition-colors"
                title="Toggle the comparison cloud between the reference lap and the selected overlays"
              >
                {activeMode === 'overlays' ? 'Overlays' : 'Ref'}
              </button>
            )}
            <button
              onClick={() => setBoxAxis((a) => (a === 'lat' ? 'lon' : 'lat'))}
              className="px-1.5 py-0.5 rounded border border-border bg-background/80 text-[10px] font-mono text-muted-foreground hover:bg-muted/50 transition-colors"
              title="Toggle the readout between lateral and longitudinal G"
            >
              {boxAxis === 'lat' ? 'Lat G' : 'Lon G'}
            </button>
          </div>
          <div className="rounded border border-border bg-background/80 px-1.5 py-1 font-mono text-[10px] leading-tight">
            {boxRows.map((row) => {
              const v = boxAxis === 'lat' ? row.lat[currentIndex] : row.lon[currentIndex];
              const text = v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}g`;
              return (
                <div key={row.label} className="flex items-center justify-end gap-1.5">
                  <span className="max-w-[120px] truncate" style={{ color: row.color }}>
                    {row.label}
                  </span>
                  <span className="tabular-nums text-foreground">{text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <GraphResizeHandle
        height={cardHeight}
        onResize={setCardHeight}
        onCommit={(h) => { setCardHeight(h); onHeightChange?.(h); }}
      />
    </div>
  );
}
