/**
 * "Latest wins" guard for async work whose result only makes sense in the
 * context that started it (e.g. a background video copy that must not attach
 * to a session the user has since left).
 *
 * `claim()` starts a new piece of work and returns a checker that stays true
 * only until the next `claim()` or `invalidate()`; anything that changes the
 * context calls `invalidate()` so every in-flight result is dropped.
 */
export interface LatestGate {
  /** Start new work; the returned checker is true until anything supersedes it. */
  claim(): () => boolean;
  /** Supersede every in-flight claim. */
  invalidate(): void;
}

export function createLatestGate(): LatestGate {
  let generation = 0;
  return {
    claim() {
      const mine = ++generation;
      return () => generation === mine;
    },
    invalidate() {
      generation++;
    },
  };
}
