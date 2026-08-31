/**
 * Unit tests for the unified overlay scene renderer (plan 0023): box
 * measurement, label injection, graph history, sector display states and the
 * data-time completion sweep, and the render loop's visibility gate. Uses a
 * recording stub for the 2D context surface the draws touch, in the style of
 * canvas2d.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  measureOverlay,
  drawDigital,
  drawGraph,
  drawPace,
  drawSector,
  drawLapTime,
  renderOverlaysToCanvas,
  DEFAULT_OVERLAY_LABELS,
  SECTOR_SWEEP_MS,
  type OverlayLabels,
  type GraphHistories,
} from "./overlayCanvasRenderer";
import { computeSectorDisplayStates } from "@/components/video-overlays/sectorUtils";
import type { DataSourceDef, OverlayInstance, OverlayRenderContext } from "@/components/video-overlays/types";
import type { GpsSample, Lap, SectorTimes } from "@/types/racing";

// ─── stubs & fixtures ───────────────────────────────────────────────────────

/** Recording stub for the 2D context surface the draw functions use. */
function makeStubCtx() {
  const calls: string[] = [];
  const texts: string[] = [];
  const fillStyles: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of [
    "save", "restore", "beginPath", "arc", "moveTo", "lineTo", "stroke",
    "fill", "fillRect", "clearRect", "clip", "roundRect", "scale", "setTransform",
  ]) {
    ctx[m] = (...args: unknown[]) => { calls.push(`${m}(${args.map(String).join(",")})`); };
  }
  ctx.fillText = (text: string) => { calls.push(`fillText(${text})`); texts.push(text); };
  Object.defineProperty(ctx, "fillStyle", {
    set(v: string) { fillStyles.push(v); },
    get() { return fillStyles[fillStyles.length - 1] ?? ""; },
  });
  for (const p of ["strokeStyle", "font", "textAlign", "textBaseline", "lineWidth", "lineCap", "lineJoin", "shadowColor", "shadowBlur"]) {
    let v: unknown;
    Object.defineProperty(ctx, p, { set(x: unknown) { v = x; }, get() { return v; } });
  }
  return { c: ctx as unknown as CanvasRenderingContext2D, calls, texts, fillStyles };
}

function sample(t: number, speedKph = 72): GpsSample {
  return { t, lat: 45, lon: -73, speedMps: speedKph / 3.6, speedMph: speedKph / 1.609, speedKph, extraFields: {} };
}

const speedSource: DataSourceDef = {
  id: "speed",
  label: "Speed (KPH)",
  unit: "KPH",
  getValue: (s) => s.speedKph,
  getMin: () => 0,
  getMax: () => 180,
};

function makeRenderCtx(over: Partial<OverlayRenderContext> = {}): OverlayRenderContext {
  const samples = [sample(0), sample(100), sample(200)];
  return {
    currentSample: samples[1],
    currentIndex: 1,
    samples,
    allSamples: samples,
    dataSources: [speedSource],
    fieldMappings: [],
    laps: [],
    selectedLapNumber: null,
    course: null,
    referenceSamples: [],
    paceData: [null, null, null],
    brakingGData: [],
    useKph: true,
    containerWidth: 640,
    containerHeight: 360,
    ...over,
  };
}

function makeInstance(over: Partial<OverlayInstance> = {}): OverlayInstance {
  return {
    id: "o1",
    type: "digital",
    dataSource: "speed",
    theme: "classic",
    colorMode: "dark",
    opacity: 1,
    position: { x: 0, y: 0 },
    visible: true,
    ...over,
  };
}

function makeLap(lapNumber: number, startTime: number, lapTimeMs: number, sectors?: SectorTimes): Lap {
  return {
    lapNumber,
    startTime,
    endTime: startTime + lapTimeMs,
    lapTimeMs,
    maxSpeedMph: 0,
    maxSpeedKph: 0,
    minSpeedMph: 0,
    minSpeedKph: 0,
    startIndex: 0,
    endIndex: 0,
    sectors,
  };
}

const L = { x: 0, y: 0, fontSize: 18 };

// ─── measureOverlay ─────────────────────────────────────────────────────────

describe("measureOverlay", () => {
  it("sizes the digital box by the resolved value and unit text", () => {
    const ctx = makeRenderCtx();
    const inst = makeInstance();
    // "72.0" (4 chars) and "KPH" (3 chars)
    const { w, h } = measureOverlay(inst, ctx, 18);
    expect(w).toBeCloseTo(4 * 18 * 0.65 + 3 * 18 * 0.35 + 18 * 0.6);
    expect(h).toBeCloseTo(18 * 1.5);
  });

  it("laptime box grows when pace mode is on", () => {
    const ctx = makeRenderCtx();
    const plain = measureOverlay(makeInstance({ type: "laptime" }), ctx, 18);
    const paced = measureOverlay(makeInstance({ type: "laptime", showPaceMode: true }), ctx, 18);
    expect(plain).toEqual({ w: 18 * 5, h: 18 * 2 });
    expect(paced).toEqual({ w: 18 * 8, h: 18 * 3.2 });
  });

  it("fixed-box widgets use their spec sizes", () => {
    const ctx = makeRenderCtx();
    expect(measureOverlay(makeInstance({ type: "analog" }), ctx, 18)).toEqual({ w: 90, h: 90 });
    expect(measureOverlay(makeInstance({ type: "graph" }), ctx, 18)).toEqual({ w: 180, h: 72 });
    expect(measureOverlay(makeInstance({ type: "bar" }), ctx, 18)).toEqual({ w: 18 * 8 + 18 * 0.6, h: 18 * 1.6 });
    expect(measureOverlay(makeInstance({ type: "sector" }), ctx, 18)).toEqual({ w: 3 * 54 + 2 * 3.6, h: 28.8 });
    expect(measureOverlay(makeInstance({ type: "pace" }), ctx, 18)).toEqual({ w: 18 * 10 + 18 * 0.6, h: 18 * 2.2 });
  });
});

// ─── digital ────────────────────────────────────────────────────────────────

describe("drawDigital", () => {
  it("renders the resolved value and unit", () => {
    const { c, texts } = makeStubCtx();
    drawDigital(c, makeInstance(), makeRenderCtx(), L);
    expect(texts).toEqual(["72.0", "KPH"]);
  });

  it("renders a dash when the source has no value", () => {
    const nullSource: DataSourceDef = { ...speedSource, getValue: () => null };
    const { c, texts } = makeStubCtx();
    drawDigital(c, makeInstance(), makeRenderCtx({ dataSources: [nullSource] }), L);
    expect(texts[0]).toBe("—");
  });
});

// ─── graph ──────────────────────────────────────────────────────────────────

describe("drawGraph", () => {
  it("accumulates a rolling history capped at graphLength", () => {
    const histories: GraphHistories = new Map();
    const inst = makeInstance({ type: "graph", graphLength: 3 });
    for (let i = 0; i < 5; i++) {
      const { c } = makeStubCtx();
      drawGraph(c, inst, makeRenderCtx(), L, histories);
    }
    expect(histories.get("o1")).toHaveLength(3);
  });

  it("draws grid lines once there is history (fidelity ported from the old preview)", () => {
    const histories: GraphHistories = new Map();
    const inst = makeInstance({ type: "graph" });
    const first = makeStubCtx();
    drawGraph(first.c, inst, makeRenderCtx(), L, histories);
    const strokesEmpty = first.calls.filter((op) => op === "stroke()").length;
    const second = makeStubCtx();
    drawGraph(second.c, inst, makeRenderCtx(), L, histories);
    const strokesWithLine = second.calls.filter((op) => op === "stroke()").length;
    // background only vs background + 5 grid lines + data line
    expect(strokesEmpty).toBe(1);
    expect(strokesWithLine).toBe(1 + 5 + 1);
  });
});

// ─── pace ───────────────────────────────────────────────────────────────────

describe("drawPace", () => {
  const labels: OverlayLabels = { ...DEFAULT_OVERLAY_LABELS, slow: "LANGSAM", fast: "SCHNELL" };

  it("draws the injected SLOW/FAST labels", () => {
    const { c, texts } = makeStubCtx();
    drawPace(c, makeInstance({ type: "pace" }), makeRenderCtx(), L, labels);
    expect(texts).toContain("LANGSAM");
    expect(texts).toContain("SCHNELL");
  });

  it("colors a negative (faster) pace green", () => {
    const { c, texts, fillStyles } = makeStubCtx();
    drawPace(c, makeInstance({ type: "pace" }), makeRenderCtx({ paceData: [null, -0.42, null] }), L, labels);
    expect(texts).toContain("-0.420s");
    expect(fillStyles).toContain("#22c55e");
  });
});

// ─── laptime ────────────────────────────────────────────────────────────────

describe("drawLapTime", () => {
  it("uses the injected labels and names the best lap", () => {
    const laps = [makeLap(1, 0, 61000), makeLap(2, 61000, 59500)];
    const labels: OverlayLabels = { ...DEFAULT_OVERLAY_LABELS, lapTime: "RUNDENZEIT" };
    const { c, texts } = makeStubCtx();
    drawLapTime(c, makeInstance({ type: "laptime", showPaceMode: true }), makeRenderCtx({ laps }), L, labels);
    expect(texts).toContain("RUNDENZEIT");
    expect(texts).toContain("BEST L2");
    expect(texts).toContain("59.500"); // best lap time, formatted
  });
});

// ─── sector states + sweep ──────────────────────────────────────────────────

describe("computeSectorDisplayStates", () => {
  const sectors: SectorTimes = { s1: 30000, s2: 31000, s3: 29000 };

  it("marks the running sector active and completed sectors with results", () => {
    const laps = [makeLap(1, 0, 90000, sectors)];
    // Mid-S2: S1 finished at 30000, S2 running, S3 not reached.
    const states = computeSectorDisplayStates(laps, laps[0], 45000);
    expect(states[0].status).toBe("first"); // first lap sets the best
    expect(states[0].completedAtMs).toBe(30000);
    expect(states[1].status).toBe("active");
    expect(states[2].status).toBe("outlap");
  });

  it("scores a later lap against the best and reports deltas", () => {
    const laps = [
      makeLap(1, 0, 90000, sectors),
      makeLap(2, 90000, 91500, { s1: 30500, s2: 30800, s3: 30200 }),
    ];
    const states = computeSectorDisplayStates(laps, laps[1], 90000 + 91500);
    expect(states[0].status).toBe("slower");
    expect(states[0].deltaMs).toBe(500);
    // The best table includes the current lap, so a new best shows delta 0 —
    // same as the pre-unification widget.
    expect(states[1].status).toBe("best");
    expect(states[1].deltaMs).toBe(0);
    expect(states[2].status).toBe("slower");
  });

  it("returns three outlaps without a current lap", () => {
    const states = computeSectorDisplayStates([], null, 0);
    expect(states.map((s) => s.status)).toEqual(["outlap", "outlap", "outlap"]);
  });
});

describe("drawSector completion sweep", () => {
  const sectors: SectorTimes = { s1: 30000, s2: 31000, s3: 29000 };
  const laps = [makeLap(1, 0, 90000, sectors)];

  function ctxAt(t: number): OverlayRenderContext {
    return makeRenderCtx({ laps, currentSample: sample(t), samples: [sample(t)], allSamples: [sample(t)] });
  }

  it("sweeps in data time just after a sector completes", () => {
    const { c, calls } = makeStubCtx();
    drawSector(c, makeInstance({ type: "sector" }), ctxAt(30000 + SECTOR_SWEEP_MS / 2), L);
    expect(calls.some((op) => op.startsWith("clip"))).toBe(true);
  });

  it("stops sweeping after the window, and never sweeps with animation off", () => {
    const after = makeStubCtx();
    drawSector(after.c, makeInstance({ type: "sector" }), ctxAt(30000 + SECTOR_SWEEP_MS + 1), L);
    expect(after.calls.some((op) => op.startsWith("clip"))).toBe(false);

    const off = makeStubCtx();
    drawSector(off.c, makeInstance({ type: "sector", showAnimation: false }), ctxAt(30000 + SECTOR_SWEEP_MS / 2), L);
    expect(off.calls.some((op) => op.startsWith("clip"))).toBe(false);
  });
});

// ─── render loop ────────────────────────────────────────────────────────────

describe("renderOverlaysToCanvas", () => {
  it("skips invisible overlays and draws visible ones", () => {
    const { c, texts } = makeStubCtx();
    const overlays = [
      makeInstance({ id: "hidden", visible: false }),
      makeInstance({ id: "shown" }),
    ];
    renderOverlaysToCanvas(c, 640, 360, overlays, makeRenderCtx(), new Map());
    // Only the visible digital overlay drew its value.
    expect(texts.filter((t) => t === "72.0")).toHaveLength(1);
  });
});
