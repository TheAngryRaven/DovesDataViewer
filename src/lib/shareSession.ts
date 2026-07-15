// Build a read-only viewer bundle from a shared session (plan 0009).
//
// Unlike the leaderboard transposer (leaderboardSession.ts) — which stitches one
// lap per driver and must inject prebuilt laps — a shared session is one
// contiguous single-driver recording, so real crossing detection works: parse
// the blob client-side, then run calculateLaps against the share's FROZEN course
// geometry (captured at share time, so personal courses time precisely even when
// the recipient has never seen them). Pure (no React / no I/O) for testability.

import type { Course, ParsedData } from "@/types/racing";
import { calculateLaps } from "./lapCalculation";
import { normalizeCourseSectors } from "./courseSectors";
import type { LeaderboardSessionBundle } from "./leaderboardSession";

export interface SharedSessionContext {
  course: Course;
  trackName: string;
  courseName: string;
  /** The sharing driver's display name, when their profile resolves. */
  driverName?: string | null;
  /** The session's start date, when the share captured one. */
  sessionDate?: Date | null;
}

/**
 * Assemble the parsed data + frozen course into the same bundle shape the
 * leaderboard handoff uses, so Index's read-only injection path is shared.
 * Laps come from real crossing detection; zero laps still yields a bundle
 * (the viewer shows the full trace, like an untimed local session).
 */
export function buildSharedSessionBundle(
  parsed: ParsedData,
  share: SharedSessionContext,
): LeaderboardSessionBundle {
  const course = normalizeCourseSectors(share.course);
  const laps = calculateLaps(parsed.samples, course);

  return {
    data: parsed,
    course,
    selection: { trackName: share.trackName, courseName: share.courseName, course },
    laps,
    // Real lap numbers — no per-lap submitter labels on a single-driver session.
    lapLabels: {},
    descriptor: {
      courseName: share.courseName,
      driverLabel: share.driverName ?? undefined,
      dateLabel: share.sessionDate ? share.sessionDate.toLocaleDateString() : undefined,
    },
  };
}
