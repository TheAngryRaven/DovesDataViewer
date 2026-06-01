import { describe, it, expect } from "vitest";
import { MAX_NOTE_BYTES, noteByteLength, exceedsNoteLimit } from "./noteStorage";

describe("note size cap", () => {
  it("measures UTF-8 byte length, not character count", () => {
    expect(noteByteLength("abc")).toBe(3);
    // "é" is 2 bytes in UTF-8, "😀" is 4 — bytes, not code units.
    expect(noteByteLength("é")).toBe(2);
    expect(noteByteLength("😀")).toBe(4);
  });

  it("allows notes at or under the cap", () => {
    expect(exceedsNoteLimit("")).toBe(false);
    expect(exceedsNoteLimit("a normal field note")).toBe(false);
    expect(exceedsNoteLimit("a".repeat(MAX_NOTE_BYTES))).toBe(false);
  });

  it("rejects notes over the cap (the bulk-storage abuse case)", () => {
    expect(exceedsNoteLimit("a".repeat(MAX_NOTE_BYTES + 1))).toBe(true);
    // Multibyte content trips the byte cap below the character count.
    expect(exceedsNoteLimit("😀".repeat(MAX_NOTE_BYTES / 4 + 1))).toBe(true);
  });
});
