import { describe, expect, it } from "vitest";
import {
  hasPendingLeaderboardSession,
  setPendingLeaderboardSession,
  takePendingLeaderboardSession,
} from "./leaderboardHandoff";
import type { LeaderboardSessionBundle } from "./leaderboardSession";

const bundle = { descriptor: { courseName: "c", engineLabel: "e" } } as LeaderboardSessionBundle;

describe("leaderboardHandoff", () => {
  it("hands off a session exactly once (consume-once)", () => {
    expect(hasPendingLeaderboardSession()).toBe(false);
    setPendingLeaderboardSession(bundle);
    expect(hasPendingLeaderboardSession()).toBe(true);
    expect(takePendingLeaderboardSession()).toBe(bundle);
    // Cleared after taking.
    expect(hasPendingLeaderboardSession()).toBe(false);
    expect(takePendingLeaderboardSession()).toBeNull();
  });
});
