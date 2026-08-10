import { describe, it, expect } from "vitest";
import {
  normalizeShortName,
  initialTrackDraft,
  editTrackName,
  editTrackShortName,
  initialCourseDraft,
  editCourseName,
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
  // The box always starts holding what would be saved if you touched nothing, so
  // nothing is ever written that the user never saw.
  //
  // It used to copy the TRACK's new name — an earlier reading of "auto-populated
  // by the name". That was wrong: a course is not its track, and the screen read
  // as broken because every course came up pre-filled with the track's name.
  it("does not copy the track name", () => {
    expect(initialCourseDraft(courseRow()).name).not.toBe("Sunset Park");
  });

  // The stamp is not a valid answer for a circuit course, and pre-filling
  // anything invites clicking straight past the one thing this screen asks.
  it("starts empty for a generated circuit course", () => {
    expect(initialCourseDraft(courseRow({ kind: "circuit" }))).toEqual({
      name: "",
      touched: false,
    });
  });

  // A sprint venue re-lays its course every event, so the walked date IS a valid
  // final answer — showing it means the user can see what will be saved.
  it("keeps the stamp for a generated sprint course", () => {
    expect(initialCourseDraft(courseRow({ kind: "sprint" }))).toEqual({
      name: "N260803_1432",
      touched: false,
    });
  });

  it("keeps a real course name", () => {
    const d = initialCourseDraft(courseRow({ name: "Full CW", needsRename: false }));
    expect(d.name).toBe("Full CW");
  });

  it("marks the draft touched once the user types", () => {
    const d = editCourseName(initialCourseDraft(courseRow()), "Morning Run");
    expect(d).toEqual({ name: "Morning Run", touched: true });
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
