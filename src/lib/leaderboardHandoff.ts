// In-app handoff for the read-only leaderboard viewer (plan 0005).
//
// The /leaderboards page does the (async, potentially heavy) work of fetching a
// group's entries and transposing them into a synthetic session, then stashes the
// finished bundle here and navigates to "/". Index.tsx consumes it once on mount
// and enters read-only mode. A module-level singleton (same shape as
// fileLoadingState) keeps this off React context — it's a one-shot handoff, not
// reactive state.

import type { LeaderboardSessionBundle } from "./leaderboardSession";

let pending: LeaderboardSessionBundle | null = null;

/** Stash a built session for the next viewer mount to pick up. */
export function setPendingLeaderboardSession(bundle: LeaderboardSessionBundle): void {
  pending = bundle;
}

/** Consume the pending session (clears it) — null when there is none. */
export function takePendingLeaderboardSession(): LeaderboardSessionBundle | null {
  const p = pending;
  pending = null;
  return p;
}

/** Peek without consuming. */
export function hasPendingLeaderboardSession(): boolean {
  return pending !== null;
}
