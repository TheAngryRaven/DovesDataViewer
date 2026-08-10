import { describe, it, expect } from "vitest";
import {
  buildPickerState,
  initialPickerSelection,
  togglePickerCourse,
} from "./deviceCoursePicker";
import { DEVICE_TRACK_BYTES_SMALL, projectDeviceTrackBytes } from "./deviceTrackBudget";
import type { Course, Track } from "@/types/racing";

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    name: "Full CW",
    startFinishA: { lat: 35.4123456, lon: -97.3123456 },
    startFinishB: { lat: 35.4124567, lon: -97.3124567 },
    isUserDefined: true,
    ...overrides,
  };
}

function sprint(name: string, dateCreated: string): Course {
  return makeCourse({
    name,
    type: "sprint",
    dateCreated,
    finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
  });
}

const track = (courses: Course[]): Track => ({
  name: "Autocross Lot",
  shortName: "LOT",
  courses,
  isUserDefined: true,
});

const sprintTrack = () =>
  track([
    sprint("Run Jan", "2026-01-04T09:00"),
    sprint("Run Aug", "2026-08-09T14:32"),
    sprint("Run Mar", "2026-03-21T11:15"),
  ]);

// ─── initialPickerSelection ──────────────────────────────────────────────────

describe("initialPickerSelection", () => {
  it("starts from what is currently bound for the device", () => {
    expect(initialPickerSelection(sprintTrack().courses)).toEqual(["Run Aug"]);
  });

  it("includes courses the user explicitly kept", () => {
    const selection = initialPickerSelection(sprintTrack().courses, {
      include: ["Run Jan"],
      exclude: [],
    });
    expect(selection.sort()).toEqual(["Run Aug", "Run Jan"]);
  });

  it("starts with everything for a circuit track", () => {
    const circuit = track([makeCourse({ name: "CW" }), makeCourse({ name: "CCW" })]);
    expect(initialPickerSelection(circuit.courses)).toEqual(["CW", "CCW"]);
  });
});

// ─── buildPickerState ────────────────────────────────────────────────────────

describe("buildPickerState", () => {
  it("lists every course, whether selected or not", () => {
    const t = sprintTrack();
    const state = buildPickerState(t, ["Run Aug"], DEVICE_TRACK_BYTES_SMALL);
    expect(state.rows.map((r) => r.name)).toEqual(["Run Jan", "Run Aug", "Run Mar"]);
    expect(state.rows.map((r) => r.selected)).toEqual([false, true, false]);
  });

  it("marks the course the default rule would keep", () => {
    const t = sprintTrack();
    const state = buildPickerState(t, [], DEVICE_TRACK_BYTES_SMALL);
    expect(state.rows.filter((r) => r.isDefault).map((r) => r.name)).toEqual(["Run Aug"]);
  });

  it("marks every course as default on a circuit track", () => {
    const circuit = track([makeCourse({ name: "CW" }), makeCourse({ name: "CCW" })]);
    const state = buildPickerState(circuit, ["CW"], DEVICE_TRACK_BYTES_SMALL);
    expect(state.rows.every((r) => r.isDefault)).toBe(true);
    expect(state.accumulates).toBe(false);
  });

  it("says a sprint track accumulates, so the dialog can explain the trim", () => {
    expect(buildPickerState(sprintTrack(), [], DEVICE_TRACK_BYTES_SMALL).accumulates).toBe(
      true,
    );
  });

  it("carries the walked date through for display", () => {
    const state = buildPickerState(sprintTrack(), [], DEVICE_TRACK_BYTES_SMALL);
    expect(state.rows[0].dateCreated).toBe("2026-01-04T09:00");
  });

  // The number on screen has to be the number written, or the user is being
  // asked to drop a course on the strength of a guess.
  it("measures the exact bytes the upload would write", () => {
    const t = sprintTrack();
    const state = buildPickerState(t, ["Run Aug"], DEVICE_TRACK_BYTES_SMALL);
    expect(state.bytes).toBe(projectDeviceTrackBytes(t, [t.courses[1]]));
  });

  it("grows as courses are added", () => {
    const t = sprintTrack();
    const one = buildPickerState(t, ["Run Aug"], DEVICE_TRACK_BYTES_SMALL).bytes;
    const two = buildPickerState(t, ["Run Aug", "Run Jan"], DEVICE_TRACK_BYTES_SMALL).bytes;
    expect(two).toBeGreaterThan(one);
  });

  it("reports nothing over budget when it fits", () => {
    const state = buildPickerState(sprintTrack(), ["Run Aug"], DEVICE_TRACK_BYTES_SMALL);
    expect(state.overBy).toBe(0);
    expect(state.canConfirm).toBe(true);
  });

  it("reports the overshoot and refuses to confirm when it does not fit", () => {
    const t = sprintTrack();
    const tiny = 100;
    const state = buildPickerState(t, ["Run Aug"], tiny);
    expect(state.overBy).toBe(state.bytes - tiny);
    expect(state.overBy).toBeGreaterThan(0);
    expect(state.canConfirm).toBe(false);
  });

  // A track file with no courses is not "a smaller track" — the logger parses
  // it, finds nothing, and never detects it, which looks exactly like the
  // failure this plan exists to prevent.
  it("refuses an empty selection even though it obviously fits", () => {
    const state = buildPickerState(sprintTrack(), [], DEVICE_TRACK_BYTES_SMALL);
    expect(state.overBy).toBe(0);
    expect(state.canConfirm).toBe(false);
  });

  it("treats exactly the budget as fitting", () => {
    const t = sprintTrack();
    const exact = projectDeviceTrackBytes(t, [t.courses[1]]);
    expect(buildPickerState(t, ["Run Aug"], exact).canConfirm).toBe(true);
    expect(buildPickerState(t, ["Run Aug"], exact - 1).canConfirm).toBe(false);
  });

  it("ignores a selected name the track no longer has", () => {
    const state = buildPickerState(sprintTrack(), ["Deleted"], DEVICE_TRACK_BYTES_SMALL);
    expect(state.rows.every((r) => !r.selected)).toBe(true);
    expect(state.canConfirm).toBe(false);
  });
});

// ─── togglePickerCourse ──────────────────────────────────────────────────────

describe("togglePickerCourse", () => {
  it("adds a course that was not selected", () => {
    expect(togglePickerCourse(["A"], "B")).toEqual(["A", "B"]);
  });

  it("removes one that was", () => {
    expect(togglePickerCourse(["A", "B"], "A")).toEqual(["B"]);
  });

  it("does not mutate the list it was given", () => {
    const before = ["A"];
    togglePickerCourse(before, "B");
    expect(before).toEqual(["A"]);
  });

  it("round-trips", () => {
    expect(togglePickerCourse(togglePickerCourse(["A"], "B"), "B")).toEqual(["A"]);
  });
});
