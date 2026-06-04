import { useRef, useEffect, useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { GpsSample } from '@/types/racing';
import { computeSmoothingWindowSize } from '@/lib/chartUtils';
import { pickGForcePair, computeGGPoints, computeGGAxisMax } from '@/lib/ggDiagram';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { getChartColors } from '@/lib/chartColors';
import { GraphResizeHandle } from './GraphResizeHandle';

/** Default height (px) for the G-G diagram card. */
export const GG_DEFAULT_HEIGHT = 240;

interface GGDiagramProps {
  samples: GpsSample[];
  referenceSamples?: GpsSample[];
  currentIndex: number;
  label: string;
  onDelete: () => void;
  /** Committed card height (px); defaults to GG_DEFAULT_HEIGHT. */
  height?: number;
  /** Persist a new card height (fired on resize-drag release). */
  onHeightChange?: (height: number) => void;
}

const SESSION_COLOR = 'hsl(180, 70%, 55%)'; // cyan cloud (matches speed series)
const CURRENT_COLOR = 'hsl(0, 75%, 55%)';   // red current point

export function GGDiagram({ samples, referenceSamples, currentIndex, label, onDelete, height, onHeightChange }: GGDiagramProps) {
  const { gForceSmoothing, gForceSmoothingStrength, gForceSource, darkMode } = useSettingsContext();
  const chartColors = useMemo(() => getChartColors(darkMode), [darkMode]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Live card height — driven by the resize handle, seeded from the committed prop.
  const committedHeight = height ?? GG_DEFAULT_HEIGHT;
  const [cardHeight, setCardHeight] = useState(committedHeight);
  useEffect(() => { setCardHeight(committedHeight); }, [committedHeight]);

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
    () => (pair && referenceSamples && referenceSamples.length > 0
      ? computeGGPoints(referenceSamples, pair, smoothingWindow)
      : []),
    [referenceSamples, pair, smoothingWindow],
  );
  const axisMax = useMemo(() => computeGGAxisMax(sessionPoints, refPoints), [sessionPoints, refPoints]);

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

    drawCloud(refPoints, chartColors.refLine, 0.5);
    drawCloud(sessionPoints, SESSION_COLOR, 0.45);

    // Current point.
    const cur = sessionPoints[currentIndex];
    if (cur) {
      ctx.beginPath();
      ctx.fillStyle = CURRENT_COLOR;
      ctx.arc(sx(cur.x), sy(cur.y), 4, 0, Math.PI * 2);
      ctx.fill();

      // Readout in the bottom-right corner (clear of the header + delete button).
      ctx.fillStyle = chartColors.axisText;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`Lon ${cur.y >= 0 ? '+' : ''}${cur.y.toFixed(2)}g`, dimensions.width - 4, dimensions.height - 4);
      ctx.fillText(`Lat ${cur.x >= 0 ? '+' : ''}${cur.x.toFixed(2)}g`, dimensions.width - 4, dimensions.height - 16);
    }

    // Source badge, bottom-left.
    ctx.fillStyle = chartColors.axisText;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(pair.source, 4, dimensions.height - 4);
  }, [dimensions, sessionPoints, refPoints, axisMax, currentIndex, pair, chartColors]);

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
      <GraphResizeHandle
        height={cardHeight}
        onResize={setCardHeight}
        onCommit={(h) => { setCardHeight(h); onHeightChange?.(h); }}
      />
    </div>
  );
}
