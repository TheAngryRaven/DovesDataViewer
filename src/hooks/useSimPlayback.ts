/**
 * useSimPlayback — owns the firmware-sim instance and the playback loop
 * (plan 0010, Phase A). One concern: virtual time. The page renders; the
 * pure math lives in lib/sim/simPlayback.
 *
 * The rAF tick advances the virtual clock by wall-delta × speed, executes
 * the tick plan (inject rows at their own timestamps, stepMillis between),
 * and publishes throttled UI state. Scrubbing backward awaits the sim's
 * async reset() (true fresh boot) and headless-fast-replays to the target.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ParsedData } from "@/types/racing";
import { createSim, type BirdsEyeSim, type SimState, type SimVersion } from "@/lib/sim/simClient";
import {
  PRE_ROLL_MS,
  buildTickPlan,
  planScrub,
  preRollFrames,
  sessionEndMs,
  type TickAction,
} from "@/lib/sim/simPlayback";

export type SimPlaybackStatus = "loading" | "ready" | "error";

export interface SimPlayback {
  status: SimPlaybackStatus;
  /** Live firmware state (throttled to ~10 Hz). */
  simState: SimState | null;
  version: SimVersion | null;
  playing: boolean;
  speed: number;
  /** Playback position in session ms (0 = session start; negative = pre-roll). */
  positionMs: number;
  durationMs: number;
  inPreRoll: boolean;
  play: () => void;
  pause: () => void;
  setSpeed: (x: number) => void;
  /** Seek to a session-relative position (ms since session start). */
  seek: (sessionMs: number) => void;
  skipPreRoll: () => void;
  buttonDown: (idx: number) => void;
  buttonUp: (idx: number) => void;
  /** Blit target: called with the sim whenever the frame hash changes. */
  setFrameSink: (sink: ((sim: BirdsEyeSim) => void) | null) => void;
}

export function useSimPlayback(data: ParsedData | null): SimPlayback {
  const [status, setStatus] = useState<SimPlaybackStatus>("loading");
  const [simState, setSimState] = useState<SimState | null>(null);
  const [version, setVersion] = useState<SimVersion | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [positionMs, setPositionMs] = useState(-PRE_ROLL_MS);

  const simRef = useRef<BirdsEyeSim | null>(null);
  const frameSinkRef = useRef<((sim: BirdsEyeSim) => void) | null>(null);
  const lastHashRef = useRef(-1);
  const lastUiPushRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const busyRef = useRef(false); // guards reset/seek re-entrancy

  // Virtual playback cursor, absolute unix-ms (matches sample timestamps).
  const cursorRef = useRef(0);
  const sampleIndexRef = useRef(0);
  const preRollLeftRef = useRef<TickAction[]>([]);

  const epochMs = data?.startDate ? data.startDate.getTime() : 0;
  const durationMs = data ? sessionEndMs(data.samples, epochMs) - epochMs : 0;

  const publish = useCallback((force = false) => {
    const sim = simRef.current;
    if (!sim) return;
    const hash = sim.getFrameHash();
    if (hash !== lastHashRef.current) {
      lastHashRef.current = hash;
      frameSinkRef.current?.(sim);
    }
    const now = performance.now();
    if (force || now - lastUiPushRef.current > 100) {
      lastUiPushRef.current = now;
      setSimState(sim.getStateJson());
      setPositionMs(
        preRollLeftRef.current.length > 0
          ? -preRollLeftRef.current.length * 200
          : cursorRef.current - epochMs,
      );
    }
  }, [epochMs]);

  const runActions = useCallback((actions: TickAction[]) => {
    const sim = simRef.current;
    if (!sim) return;
    for (const a of actions) {
      if (a.pvt) sim.injectPvt(JSON.stringify(a.pvt));
      if (a.rpm !== undefined) sim.setRpm(a.rpm);
      if (a.stepMs > 0) sim.stepMillis(a.stepMs);
    }
  }, []);

  /** Fresh boot + arm the pre-roll queue; cursor parks at session start. */
  const bootFresh = useCallback(async (sim: BirdsEyeSim) => {
    await sim.reset();
    sim.init();
    preRollLeftRef.current = preRollFrames(epochMs);
    cursorRef.current = epochMs;
    sampleIndexRef.current = 0;
    lastHashRef.current = -1;
  }, [epochMs]);

  // Instance lifecycle.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      try {
        const sim = await createSim();
        if (cancelled) return;
        sim.init();
        simRef.current = sim;
        preRollLeftRef.current = preRollFrames(epochMs);
        cursorRef.current = epochMs;
        sampleIndexRef.current = 0;
        setVersion(sim.getVersion());
        setStatus("ready");
        publish(true);
      } catch (err) {
        console.error("sim load failed", err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      simRef.current = null;
    };
  }, [data, epochMs, publish]);

  // The playback loop.
  useEffect(() => {
    if (status !== "ready" || !data) return;
    let raf = 0;
    let prev = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const wallDelta = Math.min(now - prev, 100);
      prev = now;
      const sim = simRef.current;
      if (!sim || busyRef.current) return;

      if (!playingRef.current) {
        // Paused: keep the firmware's own clock breathing so held buttons,
        // menu timers and the display loop stay live for interaction.
        sim.stepMillis(wallDelta);
        publish();
        return;
      }

      const delta = wallDelta * speedRef.current;

      // Pre-roll queue first (skippable, fixed cadence).
      if (preRollLeftRef.current.length > 0) {
        let budget = delta;
        while (budget > 0 && preRollLeftRef.current.length > 0) {
          const a = preRollLeftRef.current.shift()!;
          runActions([a]);
          budget -= a.stepMs;
        }
        publish();
        return;
      }

      const from = cursorRef.current;
      const to = Math.min(from + delta, epochMs + durationMs);
      if (to > from) {
        const { actions, nextIndex } = buildTickPlan(
          data.samples, epochMs, from, to, sampleIndexRef.current,
        );
        runActions(actions);
        cursorRef.current = to;
        sampleIndexRef.current = nextIndex;
        if (to >= epochMs + durationMs) {
          playingRef.current = false;
          setPlaying(false);
        }
      } else {
        // At the end: keep the firmware alive for menu interaction.
        sim.stepMillis(wallDelta);
      }
      publish();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, data, durationMs, epochMs, publish, runActions]);

  const seek = useCallback((sessionMs: number) => {
    const sim = simRef.current;
    if (!sim || !data || busyRef.current) return;
    const targetAbs = epochMs + Math.max(0, Math.min(sessionMs, durationMs));
    const plan = planScrub(cursorRef.current, targetAbs, epochMs);
    busyRef.current = true;
    (async () => {
      try {
        if (plan.reset) {
          await bootFresh(sim);
          // Headless pre-roll: run it at once (no rendering between).
          runActions(preRollLeftRef.current);
          preRollLeftRef.current = [];
        } else if (preRollLeftRef.current.length > 0) {
          runActions(preRollLeftRef.current);
          preRollLeftRef.current = [];
        }
        // Headless fast-replay in one plan (row-accurate, no paints).
        const { actions, nextIndex } = buildTickPlan(
          data.samples, epochMs, cursorRef.current, targetAbs,
          sampleIndexRef.current,
        );
        runActions(actions);
        cursorRef.current = targetAbs;
        sampleIndexRef.current = nextIndex;
        publish(true);
      } finally {
        busyRef.current = false;
      }
    })();
  }, [bootFresh, data, durationMs, epochMs, publish, runActions]);

  const skipPreRoll = useCallback(() => {
    if (busyRef.current || preRollLeftRef.current.length === 0) return;
    runActions(preRollLeftRef.current);
    preRollLeftRef.current = [];
    publish(true);
  }, [publish, runActions]);

  const play = useCallback(() => {
    playingRef.current = true;
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);
  const setSpeed = useCallback((x: number) => {
    speedRef.current = x;
    setSpeedState(x);
  }, []);

  const buttonDown = useCallback((idx: number) => {
    simRef.current?.buttonDown(idx);
  }, []);
  const buttonUp = useCallback((idx: number) => {
    simRef.current?.buttonUp(idx);
  }, []);

  const setFrameSink = useCallback(
    (sink: ((sim: BirdsEyeSim) => void) | null) => {
      frameSinkRef.current = sink;
      if (sink && simRef.current) {
        lastHashRef.current = -1; // force a first blit
      }
    },
    [],
  );

  return {
    status,
    simState,
    version,
    playing,
    speed,
    positionMs,
    durationMs,
    inPreRoll: preRollLeftRef.current.length > 0,
    play,
    pause,
    setSpeed,
    seek,
    skipPreRoll,
    buttonDown,
    buttonUp,
    setFrameSink,
  };
}
