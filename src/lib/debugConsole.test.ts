import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDebugEnabled,
  formatArg,
  formatArgs,
  formatEntriesForCopy,
  debugLog,
  MAX_DEBUG_ENTRIES,
  type DebugEntry,
} from './debugConsole';

describe('parseDebugEnabled', () => {
  it('enables on explicit ?dbg=true / ?dbg=1', () => {
    expect(parseDebugEnabled('?dbg=true', null)).toBe(true);
    expect(parseDebugEnabled('?dbg=1', null)).toBe(true);
  });

  it('disables on explicit ?dbg=false / ?dbg=0 even when stored', () => {
    expect(parseDebugEnabled('?dbg=false', 'true')).toBe(false);
    expect(parseDebugEnabled('?dbg=0', 'true')).toBe(false);
  });

  it('falls back to the stored flag when no query param', () => {
    expect(parseDebugEnabled('', 'true')).toBe(true);
    expect(parseDebugEnabled('', null)).toBe(false);
    expect(parseDebugEnabled('?other=1', 'true')).toBe(true);
  });
});

describe('formatArg', () => {
  it('passes strings through', () => {
    expect(formatArg('hello')).toBe('hello');
  });

  it('renders Error with name, message, and stack', () => {
    const err = new Error('boom');
    const out = formatArg(err);
    expect(out).toContain('Error: boom');
  });

  it('handles null / undefined', () => {
    expect(formatArg(null)).toBe('null');
    expect(formatArg(undefined)).toBe('undefined');
  });

  it('JSON-stringifies plain objects and survives cycles', () => {
    expect(formatArg({ a: 1 })).toBe('{"a":1}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => formatArg(cyclic)).not.toThrow();
  });

  it('stringifies numbers and booleans', () => {
    expect(formatArg(42)).toBe('42');
    expect(formatArg(true)).toBe('true');
  });
});

describe('formatArgs', () => {
  it('joins multiple args with a space', () => {
    expect(formatArgs(['x', 1, { a: 2 }])).toBe('x 1 {"a":2}');
  });
});

describe('formatEntriesForCopy', () => {
  it('renders one line per entry with level and ISO time', () => {
    const entries: DebugEntry[] = [
      { id: 1, time: 0, level: 'error', text: 'bad' },
      { id: 2, time: 0, level: 'log', text: 'ok' },
    ];
    const out = formatEntriesForCopy(entries);
    expect(out.split('\n')).toHaveLength(2);
    expect(out).toContain('ERROR bad');
    expect(out).toContain('LOG ok');
  });
});

describe('debugLog ring buffer', () => {
  beforeEach(() => debugLog.clear());

  it('accumulates entries and notifies subscribers', () => {
    let calls = 0;
    const unsub = debugLog.subscribe(() => calls++);
    debugLog.add('log', 'a');
    debugLog.add('warn', 'b');
    expect(debugLog.getSnapshot().map((e) => e.text)).toEqual(['a', 'b']);
    expect(calls).toBe(2);
    unsub();
  });

  it('caps at MAX_DEBUG_ENTRIES, dropping the oldest', () => {
    for (let i = 0; i < MAX_DEBUG_ENTRIES + 50; i++) debugLog.add('log', `m${i}`);
    const snap = debugLog.getSnapshot();
    expect(snap).toHaveLength(MAX_DEBUG_ENTRIES);
    expect(snap[0].text).toBe('m50');
    expect(snap[snap.length - 1].text).toBe(`m${MAX_DEBUG_ENTRIES + 49}`);
  });

  it('returns a stable snapshot reference between mutations', () => {
    debugLog.add('log', 'a');
    const s1 = debugLog.getSnapshot();
    const s2 = debugLog.getSnapshot();
    expect(s1).toBe(s2);
    debugLog.add('log', 'b');
    expect(debugLog.getSnapshot()).not.toBe(s1);
  });
});
