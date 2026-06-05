/**
 * IndexedDB CRUD tests for noteStorage (the pure size-cap helpers are covered in
 * noteStorage.test.ts). Covers the fileName-indexed list (newest-first), the
 * save size-cap guard, garage events, and delete.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  listNotes,
  saveNote,
  deleteNote,
  MAX_NOTE_BYTES,
  type Note,
} from "./noteStorage";
import { onGarageChange } from "./garageEvents";

beforeEach(() => freshIndexedDB());

const note = (id: string, fileName: string, text = "note", createdAt = 1): Note => ({
  id,
  fileName,
  text,
  createdAt,
  updatedAt: createdAt,
});

describe("noteStorage CRUD", () => {
  it("lists notes for a file newest-first (createdAt desc), scoped by fileName", async () => {
    await saveNote(note("n1", "a.dove", "first", 100));
    await saveNote(note("n2", "a.dove", "second", 300));
    await saveNote(note("n3", "b.dove", "other", 200));
    const notes = await listNotes("a.dove");
    expect(notes.map((n) => n.id)).toEqual(["n2", "n1"]);
  });

  it("returns an empty list for a file with no notes", async () => {
    expect(await listNotes("empty.dove")).toEqual([]);
  });

  it("stamps updatedAt on save", async () => {
    const before = Date.now();
    await saveNote(note("n1", "a.dove"));
    const [saved] = await listNotes("a.dove");
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("refuses to save a note over the size cap", async () => {
    const huge = note("n1", "a.dove", "x".repeat(MAX_NOTE_BYTES + 1));
    await expect(saveNote(huge)).rejects.toThrow(/limit/i);
    expect(await listNotes("a.dove")).toHaveLength(0);
  });

  it("deletes a note", async () => {
    await saveNote(note("n1", "a.dove"));
    await deleteNote("n1");
    expect(await listNotes("a.dove")).toHaveLength(0);
  });
});

describe("noteStorage garage events", () => {
  it("emits put then delete", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await saveNote(note("n1", "a.dove"));
    await deleteNote("n1");
    off();
    expect(seen).toHaveBeenNthCalledWith(1, { store: "notes", key: "n1", type: "put" });
    expect(seen).toHaveBeenNthCalledWith(2, { store: "notes", key: "n1", type: "delete" });
  });
});
