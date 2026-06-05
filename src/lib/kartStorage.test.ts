/**
 * IndexedDB CRUD tests for the legacy kartStorage module. It shares the "karts"
 * object store with vehicleStorage (back-compat surface), so these just pin the
 * basic round-trip via the older Kart shape.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import { saveKart, listKarts, getKart, deleteKart, type Kart } from "./kartStorage";

beforeEach(() => freshIndexedDB());

const kart = (id: string, name = "Kart 1"): Kart => ({
  id,
  name,
  engine: "X30",
  number: 7,
  weight: 160,
  weightUnit: "lb",
});

describe("kartStorage CRUD", () => {
  it("saves, reads, and lists karts", async () => {
    await saveKart(kart("k1", "A"));
    await saveKart(kart("k2", "B"));
    expect(await getKart("k1")).toMatchObject({ id: "k1", engine: "X30" });
    expect((await listKarts()).map((k) => k.id).sort()).toEqual(["k1", "k2"]);
  });

  it("returns null for a missing kart", async () => {
    expect(await getKart("none")).toBeNull();
  });

  it("deletes a kart", async () => {
    await saveKart(kart("k1"));
    await deleteKart("k1");
    expect(await getKart("k1")).toBeNull();
  });
});
