import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LapSnapshot } from "@/lib/lapSnapshot";

// Drive the orchestration branches of autoSubmitSnapshotTrack by faking its
// dynamically-imported collaborators. buildCourseSubmission's own geometry is
// covered in trackSubmission.test.ts; here we only assert the skip/dedupe/invoke
// decisions that gate whether the submit-track edge call fires.
const { state } = vi.hoisted(() => ({
  state: {
    submission: null as Record<string, unknown> | null,
    submittedRecords: {} as Record<string, { hash: string }>,
    invokeResult: { data: { batch_id: "b1" } as { batch_id: string } | null, error: null as unknown },
    invokeCalls: [] as unknown[],
    marked: [] as unknown[],
  },
}));

vi.mock("@/lib/trackStorage", () => ({
  loadDefaultTracks: async () => [],
}));
vi.mock("@/lib/trackSubmission", () => ({
  buildCourseSubmission: () => state.submission,
}));
vi.mock("@/lib/submittedTracksStorage", () => ({
  loadSubmittedRecords: () => state.submittedRecords,
  markCoursesSubmitted: (subs: unknown, batchId: unknown) => {
    state.marked.push({ subs, batchId });
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (name: string, opts: unknown) => {
        state.invokeCalls.push({ name, opts });
        return Promise.resolve(state.invokeResult);
      },
    },
  },
}));

import { autoSubmitSnapshotTrack } from "./trackAutoSubmit";

const sub = {
  key: "MyTrack|MyCourse",
  type: "new_track" as const,
  trackName: "MyTrack",
  trackShortName: "MYT",
  courseName: "MyCourse",
  courseData: { foo: 1 },
  layout: [{ lat: 1, lon: 2 }],
  contentHash: "hash-1",
};

function snapshot(overrides: Partial<LapSnapshot> = {}): LapSnapshot {
  return {
    trackName: "MyTrack",
    courseName: "MyCourse",
    course: { isUserDefined: true } as LapSnapshot["course"],
    ...overrides,
  } as LapSnapshot;
}

beforeEach(() => {
  state.submission = sub;
  state.submittedRecords = {};
  state.invokeResult = { data: { batch_id: "b1" }, error: null };
  state.invokeCalls = [];
  state.marked = [];
});

describe("autoSubmitSnapshotTrack", () => {
  it("skips a course that isn't user-defined (no invoke)", async () => {
    const result = await autoSubmitSnapshotTrack(snapshot({ course: { isUserDefined: false } as LapSnapshot["course"] }));
    expect(result).toBe(false);
    expect(state.invokeCalls).toHaveLength(0);
  });

  it("skips when buildCourseSubmission returns null (matches a built-in)", async () => {
    state.submission = null;
    const result = await autoSubmitSnapshotTrack(snapshot());
    expect(result).toBe(false);
    expect(state.invokeCalls).toHaveLength(0);
  });

  it("skips when this exact content was already submitted (dedupe)", async () => {
    state.submittedRecords = { [sub.key]: { hash: sub.contentHash } };
    const result = await autoSubmitSnapshotTrack(snapshot());
    expect(result).toBe(false);
    expect(state.invokeCalls).toHaveLength(0);
  });

  it("submits a new course once and records it", async () => {
    const result = await autoSubmitSnapshotTrack(snapshot());
    expect(result).toBe(true);
    expect(state.invokeCalls).toHaveLength(1);
    expect(state.invokeCalls[0]).toMatchObject({ name: "submit-track" });
    expect(state.marked).toEqual([{ subs: [sub], batchId: "b1" }]);
  });

  it("re-submits when the content hash changed (different revision)", async () => {
    state.submittedRecords = { [sub.key]: { hash: "stale-hash" } };
    const result = await autoSubmitSnapshotTrack(snapshot());
    expect(result).toBe(true);
    expect(state.invokeCalls).toHaveLength(1);
  });

  it("propagates an edge-function error", async () => {
    state.invokeResult = { data: null, error: new Error("boom") };
    await expect(autoSubmitSnapshotTrack(snapshot())).rejects.toThrow("boom");
    expect(state.marked).toHaveLength(0);
  });
});
