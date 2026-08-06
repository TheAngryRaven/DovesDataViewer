import { describe, it, expect } from "vitest";
import {
  initWizard,
  toggleRow,
  selectedRows,
  selectedCourseRows,
  setTrackName,
  setTrackShortName,
  setCourseName,
  goToCourses,
  goToTracks,
  trackProblems,
  courseProblems,
  canAdvance,
  canSave,
  resolutions,
  type WizardState,
} from "./deviceSyncWizard";
import type { SyncCourseRow, SyncPlan, SyncTrackRow } from "./deviceSyncPlan";

function courseRow(overrides: Partial<SyncCourseRow> = {}): SyncCourseRow {
  return {
    key: "circuit:08031432::N260803_1432",
    name: "N260803_1432",
    kind: "circuit",
    needsRename: true,
    direction: "download",
    ...overrides,
  };
}

function trackRow(overrides: Partial<SyncTrackRow> = {}): SyncTrackRow {
  return {
    key: "circuit:08031432",
    shortName: "08031432",
    name: "N260803_1432",
    kind: "circuit",
    direction: "download",
    needsRename: true,
    deviceFileName: "N260803_1432.json",
    deviceOnlyCourses: [],
    courses: [courseRow()],
    ...overrides,
  };
}

function plan(rows: SyncTrackRow[]): SyncPlan {
  return { rows, skipped: [] };
}

/** One walked track, renamed properly, sitting on the course screen. */
function named(): WizardState {
  let s = initWizard(plan([trackRow()]));
  s = setTrackName(s, "circuit:08031432", "Sunset Park");
  return goToCourses(s);
}

/** …and with its circuit course named too, so the plan is actually saveable. */
function fullyNamed(): WizardState {
  return setCourseName(named(), "circuit:08031432::N260803_1432", "Full CW");
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe("initWizard", () => {
  it("starts on the track screen with everything checked", () => {
    const s = initWizard(plan([trackRow(), trackRow({ key: "circuit:OKC" })]));
    expect(s.step).toBe("tracks");
    expect(s.selected.size).toBe(2);
  });

  it("starts a device-named track with empty boxes", () => {
    const s = initWizard(plan([trackRow()]));
    expect(s.trackDrafts["circuit:08031432"]).toEqual({
      name: "",
      shortName: "",
      shortNameTouched: false,
    });
  });

  it("keeps names the user already chose", () => {
    const s = initWizard(
      plan([trackRow({ name: "Orlando Kart Center", shortName: "OKC", needsRename: false })]),
    );
    expect(s.trackDrafts["circuit:08031432"].name).toBe("Orlando Kart Center");
  });
});

// ─── Selection ───────────────────────────────────────────────────────────────

describe("selection", () => {
  it("unchecks and re-checks a row", () => {
    let s = initWizard(plan([trackRow()]));
    s = toggleRow(s, "circuit:08031432");
    expect(selectedRows(s)).toEqual([]);
    s = toggleRow(s, "circuit:08031432");
    expect(selectedRows(s)).toHaveLength(1);
  });

  // Unchecking a track you don't want to name is a legitimate way past its
  // rename requirement — otherwise one unwanted track blocks the whole sync.
  it("stops validating a row once it is unchecked", () => {
    let s = initWizard(plan([trackRow()]));
    expect(canAdvance(s)).toBe(false); // unnamed
    s = toggleRow(s, "circuit:08031432");
    expect(trackProblems(s)).toEqual({});
    expect(canAdvance(s)).toBe(false); // …but nothing is selected either
  });

  it("advances once the remaining selection is valid", () => {
    let s = initWizard(plan([trackRow(), trackRow({ key: "circuit:OKC" })]));
    s = setTrackName(s, "circuit:08031432", "Sunset Park");
    expect(canAdvance(s)).toBe(false); // the second is still unnamed
    s = toggleRow(s, "circuit:OKC");
    expect(canAdvance(s)).toBe(true);
  });

  it("only lists courses of selected tracks", () => {
    let s = initWizard(plan([trackRow(), trackRow({ key: "circuit:OKC" })]));
    expect(selectedCourseRows(s)).toHaveLength(2);
    s = toggleRow(s, "circuit:OKC");
    expect(selectedCourseRows(s)).toHaveLength(1);
  });
});

// ─── Navigation ──────────────────────────────────────────────────────────────

describe("navigation", () => {
  it("moves between the two screens", () => {
    let s = named();
    expect(s.step).toBe("courses");
    s = goToTracks(s);
    expect(s.step).toBe("tracks");
  });

  // A course is not its track. This used to copy the track's new name into
  // every generated course box, which read as a bug on the course screen.
  it("never copies the track name into a course box", () => {
    const s = named();
    expect(s.courseDrafts["circuit:08031432::N260803_1432"].name).not.toBe("Sunset Park");
    expect(s.courseDrafts["circuit:08031432::N260803_1432"].name).toBe("");
  });

  it("leaves course names alone when the track is renamed", () => {
    let s = named();
    s = setCourseName(s, "circuit:08031432::N260803_1432", "Morning Run");
    s = goToTracks(s);
    s = setTrackName(s, "circuit:08031432", "Anything Else");
    s = goToCourses(s);
    expect(s.courseDrafts["circuit:08031432::N260803_1432"].name).toBe("Morning Run");
  });

  it("does not resurrect a course name the user cleared", () => {
    let s = named();
    s = setCourseName(s, "circuit:08031432::N260803_1432", "");
    s = goToTracks(s);
    s = goToCourses(s);
    expect(s.courseDrafts["circuit:08031432::N260803_1432"].name).toBe("");
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe("trackProblems", () => {
  it("reports a track still carrying its date stamp", () => {
    let s = initWizard(plan([trackRow()]));
    s = setTrackName(s, "circuit:08031432", "N260803_1432");
    expect(trackProblems(s)["circuit:08031432"]).toBe("still_generated");
  });

  // Two tracks sharing a short name are one file on the device; the second
  // write silently overwrites the first.
  it("catches two rows resolving to the same short name", () => {
    let s = initWizard(plan([trackRow(), trackRow({ key: "circuit:B", shortName: "B" })]));
    s = setTrackName(s, "circuit:08031432", "Sunset Park");
    s = setTrackName(s, "circuit:B", "Sunset Park");
    expect(trackProblems(s)["circuit:08031432"]).toBe("short_duplicate");
    expect(trackProblems(s)["circuit:B"]).toBe("short_duplicate");
  });

  it("allows the same short name across the two folders", () => {
    let s = initWizard(plan([trackRow(), trackRow({ key: "sprint:B", kind: "sprint" })]));
    s = setTrackName(s, "circuit:08031432", "Sunset Park");
    s = setTrackName(s, "sprint:B", "Sunset Park");
    expect(trackProblems(s)).toEqual({});
  });

  // Renaming a walked track onto an already-synced track's short name would
  // overwrite that track's file on the card.
  it("refuses a short name held by a track outside this plan", () => {
    let s = initWizard(plan([trackRow()]), [{ kind: "circuit", shortName: "SP" }]);
    s = setTrackName(s, "circuit:08031432", "Sunset Park");
    expect(trackProblems(s)["circuit:08031432"]).toBe("short_duplicate");
  });

  it("ignores a reservation in the other folder", () => {
    let s = initWizard(plan([trackRow()]), [{ kind: "sprint", shortName: "SP" }]);
    s = setTrackName(s, "circuit:08031432", "Sunset Park");
    expect(trackProblems(s)).toEqual({});
  });

  it("clears once the user picks a different short name", () => {
    let s = initWizard(plan([trackRow()]), [{ kind: "circuit", shortName: "SP" }]);
    s = setTrackName(s, "circuit:08031432", "Sunset Park");
    s = setTrackShortName(s, "circuit:08031432", "SUNSET");
    expect(trackProblems(s)).toEqual({});
  });
});

describe("courseProblems", () => {
  it("blocks a circuit course left as a date stamp", () => {
    let s = initWizard(plan([trackRow({ name: "OKC", shortName: "OKC", needsRename: false })]));
    s = goToCourses(s);
    s = setCourseName(s, "circuit:08031432::N260803_1432", "N260803_1432");
    expect(courseProblems(s)["circuit:08031432::N260803_1432"]).toBe("still_generated");
    expect(canSave(s)).toBe(false);
  });

  // A sprint venue re-lays its course every event, so the walked date is the
  // useful label — the owner's explicit call.
  it("lets a sprint course keep its date stamp", () => {
    const sprint = trackRow({
      key: "sprint:08031432",
      kind: "sprint",
      name: "Sunset AX",
      shortName: "SUNAX",
      needsRename: false,
      courses: [courseRow({ key: "sprint:08031432::N260803_1432", kind: "sprint" })],
    });
    let s = initWizard(plan([sprint]));
    s = goToCourses(s);
    s = setCourseName(s, "sprint:08031432::N260803_1432", "N260803_1432");
    expect(courseProblems(s)).toEqual({});
    expect(canSave(s)).toBe(true);
  });

  it("blocks an empty course name for either kind", () => {
    let s = named();
    s = setCourseName(s, "circuit:08031432::N260803_1432", "");
    expect(courseProblems(s)["circuit:08031432::N260803_1432"]).toBe("required");
  });
});

describe("canSave", () => {
  it("is true for a fully named plan", () => {
    expect(canSave(fullyNamed())).toBe(true);
  });

  // The circuit course box now starts empty rather than inheriting the track
  // name, so naming only the track is no longer enough to save.
  it("is false while a circuit course is still unnamed", () => {
    expect(canSave(named())).toBe(false);
  });

  // Going forward, then back and clearing the track name, must not leave Save
  // live just because the course screen looks fine.
  it("re-checks the track screen, not just the course screen", () => {
    let s = fullyNamed();
    expect(canSave(s)).toBe(true);
    s = setTrackName(s, "circuit:08031432", "");
    expect(canSave(s)).toBe(false);
  });

  it("is false with nothing selected", () => {
    let s = fullyNamed();
    s = toggleRow(s, "circuit:08031432");
    expect(canSave(s)).toBe(false);
  });
});

// ─── Handing off ─────────────────────────────────────────────────────────────

describe("resolutions", () => {
  it("carries the final names through", () => {
    let s = named();
    s = setCourseName(s, "circuit:08031432::N260803_1432", "Morning Run");
    const [r] = resolutions(s);
    expect(r.name).toBe("Sunset Park");
    expect(r.shortName).toBe("SP");
    expect(r.courseNames?.["circuit:08031432::N260803_1432"]).toBe("Morning Run");
  });

  it("trims what the user typed", () => {
    let s = initWizard(plan([trackRow()]));
    s = setTrackName(s, "circuit:08031432", "  Sunset Park  ");
    expect(resolutions(s)[0].name).toBe("Sunset Park");
  });

  it("omits unchecked rows", () => {
    let s = initWizard(plan([trackRow(), trackRow({ key: "circuit:OKC" })]));
    s = toggleRow(s, "circuit:OKC");
    expect(resolutions(s)).toHaveLength(1);
    expect(resolutions(s)[0].row.key).toBe("circuit:08031432");
  });
});
