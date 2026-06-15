import { describe, it, expect } from 'vitest';
import {
  initSessionGate,
  stepSessionGate,
  endSessionGate,
  ARM_SPEED_MPH,
  STOP_SPEED_MPH,
  AUTO_END_STOPPED_MS,
  type SessionGateState,
} from './sessionGate';

describe('sessionGate', () => {
  it('starts in waiting', () => {
    expect(initSessionGate()).toEqual({ phase: 'waiting', stoppedSinceMs: null });
  });

  it('stays waiting below the arm speed', () => {
    const r = stepSessionGate(initSessionGate(), ARM_SPEED_MPH, 0); // not strictly greater
    expect(r.state.phase).toBe('waiting');
    expect(r.justArmed).toBe(false);
  });

  it('arms and begins recording once above the arm speed', () => {
    const r = stepSessionGate(initSessionGate(), ARM_SPEED_MPH + 0.1, 1_000);
    expect(r.state.phase).toBe('recording');
    expect(r.justArmed).toBe(true);
    expect(r.state.stoppedSinceMs).toBeNull();
  });

  it('keeps recording while moving and holds no idle timer', () => {
    const rec: SessionGateState = { phase: 'recording', stoppedSinceMs: null };
    const r = stepSessionGate(rec, 30, 5_000);
    expect(r.state).toEqual(rec);
    expect(r.autoEnded).toBe(false);
  });

  it('starts the idle timer when stopped but does not end early', () => {
    const rec: SessionGateState = { phase: 'recording', stoppedSinceMs: null };
    const r = stepSessionGate(rec, STOP_SPEED_MPH, 10_000);
    expect(r.state.phase).toBe('recording');
    expect(r.state.stoppedSinceMs).toBe(10_000);
    expect(r.autoEnded).toBe(false);
  });

  it('clears the idle timer if it moves again before timeout', () => {
    const stopped: SessionGateState = { phase: 'recording', stoppedSinceMs: 10_000 };
    const r = stepSessionGate(stopped, 20, 30_000);
    expect(r.state.stoppedSinceMs).toBeNull();
    expect(r.autoEnded).toBe(false);
  });

  it('auto-ends after the stopped timeout elapses', () => {
    const stopped: SessionGateState = { phase: 'recording', stoppedSinceMs: 10_000 };
    const r = stepSessionGate(stopped, 0, 10_000 + AUTO_END_STOPPED_MS);
    expect(r.state.phase).toBe('ended');
    expect(r.autoEnded).toBe(true);
  });

  it('is terminal once ended', () => {
    const ended: SessionGateState = { phase: 'ended', stoppedSinceMs: 1 };
    const r = stepSessionGate(ended, 50, 999_999);
    expect(r.state).toBe(ended);
    expect(r.autoEnded).toBe(false);
    expect(r.justArmed).toBe(false);
  });

  it('endSessionGate forces ended (manual stop)', () => {
    expect(endSessionGate({ phase: 'recording', stoppedSinceMs: null }).phase).toBe('ended');
  });
});
