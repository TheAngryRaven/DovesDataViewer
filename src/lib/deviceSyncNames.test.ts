import { describe, it, expect } from "vitest";
import {
  normalizeShortName,
  initialTrackDraft,
  editTrackName,
  editTrackShortName,
  initialCourseDraft,
  editCourseName,
  retargetCourseDraft,
  validateTrackDraft,
  validateCourseDraft,
} from "./deviceSyncNames";
import type { SyncCourseRow, SyncTrackRow } from "./deviceSyncPlan";

function trackRow(overrides: Partial<SyncTrackRow> = {}): SyncTrackRow {
  return {
    key: "circuit:08031432",
    shortName: "08031432",
    name: "N260803_1432",
    kind: "circuit",
    direction: "download",
    needsRename: true,
    deviceOnlyCourses: [],
    courses: [],
    ...overrides,
  };
}

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

// ─── normalizeShortName ──────────────────────────────────────────────────────

describe("normalizeShortName", () => {
  it("strips anything the device filename can't hold", () => {
    expect(normalizeShortName("Sun set!/..")).toBe("SUNSET");
  });

  it("uppercases and caps at 8", () => {
    expect(normalizeShortName("abcdefghij")).toBe("ABCDEFGH");
  });

  it("can produce an empty string", () => {
    expect(normalizeShortName("!!!")).toBe("");
  });
});

// ─── Track name editing ──────────────────────────────────────────────────────

describe("initialTrackDraft", () => {
  // The row exists because the name is unusable; pre-filling it invites the user
  // to click straight past the thing they were asked to do.
  it("starts empty for a device-generated name", () => {
    expect(initialTrackDraft(trackRow())).toEqual({
      name: "",
      shortName: "",
      shortNameTouched: false,
    });
  });

  it("keeps a name the user already chose", () => {
    const draft = initialTrackDraft(
      trackRow({ name: "Orlando Kart Center", shortName: "OKC", needsRename: false }),
    );
    expect(draft.name).toBe("Orlando Kart Center");
    expect(draft.shortName).toBe("OKC");
  });

  it("derives a short name when the existing one is unusable", () => {
    const draft = initialTrackDraft(
      trackRow({ name: "Sunset Park", shortName: "!!", needsRename: false }),
    );
    expect(draft.shortName).toBe("SP");
  });
});

describe("editTrackName", () => {
  it("derives the short name as the user types", () => {
    let d = initialTrackDraft(trackRow());
    d = editTrackName(d, "Sunset Park");
    expect(d.name).toBe("Sunset Park");
    expect(d.shortName).toBe("SP");
  });

  it("derives 4 letters from a single word", () => {
    expect(editTrackName(initialTrackDraft(trackRow()), "Bushnell").shortName).toBe("BUSH");
  });

  // The user's explicit call: "if they edit it then edit the full name, just
  // regen the short name, their fault they changed it".
  it("re-derives over a short name the user had customised", () => {
    let d = initialTrackDraft(trackRow());
    d = editTrackName(d, "Sunset Park");
    d = editTrackShortName(d, "SUNSET");
    expect(d.shortName).toBe("SUNSET");
    expect(d.shortNameTouched).toBe(true);

    d = editTrackName(d, "Sunset Park North");
    expect(d.shortName).toBe("SPN");
    expect(d.shortNameTouched).toBe(false);
  });
});

describe("editTrackShortName", () => {
  it("normalizes what the user types", () => {
    const d = editTrackShortName(initialTrackDraft(trackRow()), "sun-set park!");
    expect(d.shortName).toBe("SUNSETPA");
  });

  it("leaves the long name alone", () => {
    let d = editTrackName(initialTrackDraft(trackRow()), "Sunset Park");
    d = editTrackShortName(d, "SP2");
    expect(d.name).toBe("Sunset Park");
  });
});

// ─── Course name editing ─────────────────────────────────────────────────────

describe("course name drafts", () => {
  // The firmware gives a new track and its first course the same stamp, so the
  // course is the track named twice — following the track name is the right default.
  it("follows the track's new name when generated", () => {
    expect(initialCourseDraft(courseRow(), "Sunset Park")).toEqual({
      name: "Sunset Park",
      touched: false,
    });
  });

  it("keeps a real course name", () => {
    const d = initialCourseDraft(courseRow({ name: "Full CW", needsRename: false }), "Sunset Park");
    expect(d.name).toBe("Full CW");
  });

  it("re-points an untouched draft when the track is renamed", () => {
    const d = initialCourseDraft(courseRow(), "Sunset Park");
    expect(retargetCourseDraft(d, "Sunset Park North").name).toBe("Sunset Park North");
  });

  it("never overwrites a course name the user typed", () => {
    let d = initialCourseDraft(courseRow(), "Sunset Park");
    d = editCourseName(d, "Sunset Park - Reverse");
    expect(retargetCourseDraft(d, "Anything Else").name).toBe("Sunset Park - Reverse");
  });
});

// ─── Track validation ────────────────────────────────────────────────────────

describe("validateTrackDraft", () => {
  const ok = { name: "Sunset Park", shortName: "SUNSET", shortNameTouched: false };

  it("passes a good draft", () => {
    expect(validateTrackDraft(ok)).toBeNull();
  });

  it("requires a name", () => {
    expect(validateTrackDraft({ ...ok, name: "   " })).toBe("required");
  });

  // Both kinds. A venue is permanent — a date stamp is never the right name for
  // one, even when its courses get re-walked every event.
  it("refuses a name left as the device's date stamp", () => {
    expect(validateTrackDraft({ ...ok, name: "N260803_1432" })).toBe("still_generated");
  });

  it("requires a short name", () => {
    expect(validateTrackDraft({ ...ok, shortName: "" })).toBe("short_required");
  });

  it("refuses characters the device filename can't hold", () => {
    expect(validateTrackDraft({ ...ok, shortName: "SUN SET" })).toBe("short_charset");
    expect(validateTrackDraft({ ...ok, shortName: "SUN.SET" })).toBe("short_charset");
  });

  it("refuses a short name past the 8-char budget", () => {
    expect(validateTrackDraft({ ...ok, shortName: "SUNSETPARK" })).toBe("short_too_long");
  });

  // Two tracks sharing a short name would be one file on the device — the
  // second write would silently overwrite the first.
  it("refuses a short name another row or device file already claims", () => {
    expect(validateTrackDraft(ok, { takenShortNames: ["OKC", "SUNSET"] })).toBe(
      "short_duplicate",
    );
  });

  it("compares claimed names case-insensitively", () => {
    expect(validateTrackDraft(ok, { takenShortNames: ["sunset"] })).toBe("short_duplicate");
  });

  it("passes when nothing else claims the name", () => {
    expect(validateTrackDraft(ok, { takenShortNames: ["OKC"] })).toBeNull();
  });
});

// ─── Course validation ───────────────────────────────────────────────────────

describe("validateCourseDraft", () => {
  it("requires a name for either kind", () => {
    expect(validateCourseDraft({ name: "", touched: false }, "circuit")).toBe("required");
    expect(validateCourseDraft({ name: "  ", touched: false }, "sprint")).toBe("required");
  });

  it("refuses a circuit course left as the device's date stamp", () => {
    expect(validateCourseDraft({ name: "N260803_1432", touched: false }, "circuit")).toBe(
      "still_generated",
    );
  });

  // A sprint venue re-lays its course every event, so the date it was walked
  // genuinely is the most useful label. Forcing a name would just get noise.
  it("allows a sprint course to keep the device's date stamp", () => {
    expect(validateCourseDraft({ name: "N260803_1432", touched: false }, "sprint")).toBeNull();
  });

  it("passes a named course of either kind", () => {
    expect(validateCourseDraft({ name: "Full CW", touched: true }, "circuit")).toBeNull();
    expect(validateCourseDraft({ name: "Morning Run", touched: true }, "sprint")).toBeNull();
  });
});
