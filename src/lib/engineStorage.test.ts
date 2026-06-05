/**
 * IndexedDB CRUD tests for engineStorage — the reusable engine-type list.
 * Covers round-trip, the updatedAt stamp, and garage-change events.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import { saveEngine, listEngines, deleteEngine, type Engine } from "./engineStorage";
import { onGarageChange } from "./garageEvents";

beforeEach(() => freshIndexedDB());

const engine = (id: string, name = "X30"): Engine => ({ id, name, createdAt: 1 });

describe("engineStorage CRUD", () => {
  it("saves and lists engines", async () => {
    await saveEngine(engine("e1", "X30"));
    await saveEngine(engine("e2", "KA100"));
    expect((await listEngines()).map((e) => e.name).sort()).toEqual(["KA100", "X30"]);
  });

  it("stamps updatedAt on save", async () => {
    const before = Date.now();
    await saveEngine(engine("e1"));
    const [saved] = await listEngines();
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("overwrites on re-save and deletes", async () => {
    await saveEngine(engine("e1", "X30"));
    await saveEngine(engine("e1", "X30 Shifter"));
    expect(await listEngines()).toHaveLength(1);
    await deleteEngine("e1");
    expect(await listEngines()).toHaveLength(0);
  });
});

describe("engineStorage garage events", () => {
  it("emits put then delete", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await saveEngine(engine("e1"));
    await deleteEngine("e1");
    off();
    expect(seen).toHaveBeenNthCalledWith(1, { store: "engines", key: "e1", type: "put" });
    expect(seen).toHaveBeenNthCalledWith(2, { store: "engines", key: "e1", type: "delete" });
  });
});
