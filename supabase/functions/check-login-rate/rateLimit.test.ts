import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  isLocked,
  recordFailure,
  type AttemptRow,
  type RateConfig,
} from "./rateLimit";

const NOW = Date.UTC(2026, 5, 21, 12, 0, 0); // fixed clock
const cfg: RateConfig = { maxFailures: 5, lockMs: 60 * 60 * 1000, windowMs: 15 * 60 * 1000 };

const iso = (ms: number) => new Date(ms).toISOString();

describe("isLocked", () => {
  it("is false for no row", () => {
    expect(isLocked(null, NOW)).toBe(false);
    expect(isLocked(undefined, NOW)).toBe(false);
  });

  it("is false when there is no lock", () => {
    expect(isLocked({ attempts: 3, locked_until: null }, NOW)).toBe(false);
  });

  it("is true only while the lock is in the future", () => {
    expect(isLocked({ attempts: 0, locked_until: iso(NOW + 1000) }, NOW)).toBe(true);
    expect(isLocked({ attempts: 0, locked_until: iso(NOW - 1000) }, NOW)).toBe(false);
  });
});

describe("recordFailure", () => {
  it("inserts the first failure for a new IP", () => {
    const d = recordFailure(null, NOW, cfg);
    expect(d.allowed).toBe(true);
    expect(d.op).toEqual({ kind: "insert", attempts: 1 });
  });

  it("increments within the sliding window", () => {
    const row: AttemptRow = { attempts: 2, locked_until: null, updated_at: iso(NOW - 60 * 1000) };
    const d = recordFailure(row, NOW, cfg);
    expect(d.allowed).toBe(true);
    expect(d.op).toEqual({ kind: "update", attempts: 3, lockedUntil: null });
  });

  it("restarts the count when the last failure is older than the window", () => {
    const row: AttemptRow = { attempts: 4, locked_until: null, updated_at: iso(NOW - 20 * 60 * 1000) };
    const d = recordFailure(row, NOW, cfg);
    expect(d.allowed).toBe(true);
    expect(d.op).toEqual({ kind: "update", attempts: 1, lockedUntil: null });
  });

  it("locks out on the Nth failure and resets the counter under the lock", () => {
    const row: AttemptRow = { attempts: 4, locked_until: null, updated_at: iso(NOW - 60 * 1000) };
    const d = recordFailure(row, NOW, cfg);
    expect(d.allowed).toBe(false);
    expect(d.lockedUntil).toBe(iso(NOW + cfg.lockMs));
    expect(d.op).toEqual({ kind: "update", attempts: 0, lockedUntil: iso(NOW + cfg.lockMs) });
  });

  it("treats a missing updated_at as stale (counts from 1)", () => {
    const row: AttemptRow = { attempts: 3, locked_until: null };
    const d = recordFailure(row, NOW, cfg);
    expect(d.op).toEqual({ kind: "update", attempts: 1, lockedUntil: null });
  });

  it("uses sane defaults", () => {
    expect(DEFAULT_CONFIG.maxFailures).toBe(5);
    expect(DEFAULT_CONFIG.lockMs).toBe(60 * 60 * 1000);
    expect(DEFAULT_CONFIG.windowMs).toBe(15 * 60 * 1000);
  });
});
