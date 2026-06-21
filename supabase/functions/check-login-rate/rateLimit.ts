// Pure failed-login rate-limit decisions — no I/O, so the edge function and its
// tests share the exact same logic. The function (index.ts) does the Supabase
// reads/writes and translates the returned `op` into table mutations.
//
// The original limiter counted EVERY login attempt (successes included) as a
// failure on a pre-login check, locking out users who could actually sign in.
// The model here separates the three things that happen:
//   • a pre-login "check" only reads lock state (never mutates),
//   • a failure is recorded only when the password is actually wrong, and
//   • a success clears the counter.
// Failures are also counted in a sliding window so a stray wrong password days
// ago doesn't combine with today's to trigger a surprise lockout.

export interface AttemptRow {
  attempts: number | null;
  locked_until: string | null;
  /** Last time this row was written — the trigger maintains it. */
  updated_at?: string | null;
}

export interface RateConfig {
  /** Failures within the window before the IP is locked out. */
  maxFailures: number;
  /** Lockout duration once tripped (ms). */
  lockMs: number;
  /** Sliding window over which failures accumulate (ms). */
  windowMs: number;
}

export const DEFAULT_CONFIG: RateConfig = {
  maxFailures: 5,
  lockMs: 60 * 60 * 1000, // 1 hour
  windowMs: 15 * 60 * 1000, // 15 minutes
};

/** The table mutation a decision wants persisted (the function performs it). */
export type AttemptOp =
  | { kind: "insert"; attempts: number }
  | { kind: "update"; attempts: number; lockedUntil: string | null };

export interface FailureDecision {
  /** False once the lockout has just been tripped. */
  allowed: boolean;
  /** Set when a lockout is now in effect. */
  lockedUntil?: string;
  op: AttemptOp;
}

/** Whether `row` is under an active lockout at time `now` (ms epoch). */
export function isLocked(row: AttemptRow | null | undefined, now: number): boolean {
  return !!row?.locked_until && new Date(row.locked_until).getTime() > now;
}

/**
 * Decide what recording one failed login does. Assumes the caller has already
 * confirmed the IP is not currently locked (see `isLocked`).
 */
export function recordFailure(
  row: AttemptRow | null | undefined,
  now: number,
  cfg: RateConfig = DEFAULT_CONFIG,
): FailureDecision {
  if (!row) {
    return { allowed: true, op: { kind: "insert", attempts: 1 } };
  }

  // Failures older than the window don't count toward the current streak.
  const lastSeen = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const withinWindow = now - lastSeen <= cfg.windowMs;
  const attempts = (withinWindow ? row.attempts ?? 0 : 0) + 1;

  if (attempts >= cfg.maxFailures) {
    const lockedUntil = new Date(now + cfg.lockMs).toISOString();
    // Reset the counter under the lock so it starts clean when the lock expires.
    return { allowed: false, lockedUntil, op: { kind: "update", attempts: 0, lockedUntil } };
  }

  return { allowed: true, op: { kind: "update", attempts, lockedUntil: null } };
}
