/**
 * Session gate — the pure state machine deciding when the phone datalogger is
 * actively recording, mirroring the physical logger's auto-race / auto-idle
 * behavior:
 *  - **Arm**: start recording once speed first exceeds `ARM_SPEED_MPH` (5 mph).
 *  - **Auto-end**: while recording, if speed stays at/below `STOP_SPEED_MPH`
 *    (≈stationary) continuously for `AUTO_END_STOPPED_MS` (5 min), end the
 *    session.
 * Kept pure (no timers/clocks of its own — the caller passes `nowMs`) so it's
 * deterministic and unit-testable.
 */
export type SessionPhase = 'waiting' | 'recording' | 'ended';

export interface SessionGateState {
  phase: SessionPhase;
  /** Epoch ms when speed first dropped to ≤ stop while recording; null otherwise. */
  stoppedSinceMs: number | null;
}

/** Speed (mph) above which the session arms and recording begins. */
export const ARM_SPEED_MPH = 5;
/** Speed (mph) at/below which the vehicle counts as stopped for the idle timer. */
export const STOP_SPEED_MPH = 1;
/** Continuous stopped time (ms) that auto-ends a recording session. */
export const AUTO_END_STOPPED_MS = 5 * 60_000;

export function initSessionGate(): SessionGateState {
  return { phase: 'waiting', stoppedSinceMs: null };
}

export interface SessionGateStep {
  state: SessionGateState;
  /** True on the transition into `ended` via the idle timeout. */
  autoEnded: boolean;
  /** True on the transition from `waiting` into `recording`. */
  justArmed: boolean;
}

/**
 * Advance the gate for one speed reading at `nowMs`. Returns the next state plus
 * edge flags for the caller to react to (begin logging / save + close session).
 * Idempotent in `ended`.
 */
export function stepSessionGate(
  state: SessionGateState,
  speedMph: number,
  nowMs: number,
): SessionGateStep {
  if (state.phase === 'ended') {
    return { state, autoEnded: false, justArmed: false };
  }

  if (state.phase === 'waiting') {
    if (speedMph > ARM_SPEED_MPH) {
      return { state: { phase: 'recording', stoppedSinceMs: null }, autoEnded: false, justArmed: true };
    }
    return { state, autoEnded: false, justArmed: false };
  }

  // recording
  const stopped = speedMph <= STOP_SPEED_MPH;
  if (!stopped) {
    // Moving again — clear the idle timer if it was running.
    if (state.stoppedSinceMs === null) return { state, autoEnded: false, justArmed: false };
    return { state: { phase: 'recording', stoppedSinceMs: null }, autoEnded: false, justArmed: false };
  }

  const stoppedSinceMs = state.stoppedSinceMs ?? nowMs;
  if (nowMs - stoppedSinceMs >= AUTO_END_STOPPED_MS) {
    return { state: { phase: 'ended', stoppedSinceMs }, autoEnded: true, justArmed: false };
  }
  return { state: { phase: 'recording', stoppedSinceMs }, autoEnded: false, justArmed: false };
}

/** Force the session to ended (manual "End session"). */
export function endSessionGate(state: SessionGateState): SessionGateState {
  return { phase: 'ended', stoppedSinceMs: state.stoppedSinceMs };
}
