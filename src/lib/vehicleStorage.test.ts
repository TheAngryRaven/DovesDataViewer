/**
 * IndexedDB CRUD tests for vehicleStorage (the "karts" store, renamed). Covers
 * the round-trip, the updatedAt stamp applied on save, and the garage-change
 * events the cloud-sync plugin rides on.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  saveVehicle,
  listVehicles,
  getVehicle,
  deleteVehicle,
  type Vehicle,
} from "./vehicleStorage";
import { onGarageChange } from "./garageEvents";

beforeEach(() => freshIndexedDB());

function vehicle(id: string, name = "Kart 1"): Vehicle {
  return {
    id,
    name,
    vehicleTypeId: "default-kart-type",
    engine: "X30",
    number: 7,
    weight: 160,
    weightUnit: "lb",
  };
}

describe("vehicleStorage CRUD", () => {
  it("saves and reads a vehicle by id", async () => {
    await saveVehicle(vehicle("v1"));
    expect(await getVehicle("v1")).toMatchObject({ id: "v1", engine: "X30", number: 7 });
  });

  it("stamps updatedAt on save", async () => {
    const before = Date.now();
    await saveVehicle(vehicle("v1"));
    const saved = await getVehicle("v1");
    expect(saved!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("returns null for a missing vehicle", async () => {
    expect(await getVehicle("ghost")).toBeNull();
  });

  it("lists all vehicles", async () => {
    await saveVehicle(vehicle("v1", "A"));
    await saveVehicle(vehicle("v2", "B"));
    expect((await listVehicles()).map((v) => v.id).sort()).toEqual(["v1", "v2"]);
  });

  it("overwrites on re-save (same id)", async () => {
    await saveVehicle(vehicle("v1", "First"));
    await saveVehicle(vehicle("v1", "Renamed"));
    expect((await listVehicles())).toHaveLength(1);
    expect((await getVehicle("v1"))!.name).toBe("Renamed");
  });

  it("deletes a vehicle", async () => {
    await saveVehicle(vehicle("v1"));
    await deleteVehicle("v1");
    expect(await getVehicle("v1")).toBeNull();
  });
});

describe("vehicleStorage garage events", () => {
  it("emits a put event on save", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await saveVehicle(vehicle("v1"));
    off();
    expect(seen).toHaveBeenCalledWith({ store: "karts", key: "v1", type: "put" });
  });

  it("emits a delete event on delete", async () => {
    await saveVehicle(vehicle("v1"));
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await deleteVehicle("v1");
    off();
    expect(seen).toHaveBeenCalledWith({ store: "karts", key: "v1", type: "delete" });
  });
});
