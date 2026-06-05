/**
 * IndexedDB CRUD tests for setupStorage. Beyond the round-trip, this pins
 * `getLatestSetupForVehicle` (vehicleId index + newest-by-updatedAt pick) and the
 * newest-first list ordering, plus garage-change events.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  listSetups,
  saveSetup,
  deleteSetup,
  getSetup,
  getLatestSetupForVehicle,
  type VehicleSetup,
} from "./setupStorage";
import { onGarageChange } from "./garageEvents";

beforeEach(() => freshIndexedDB());

function setup(id: string, vehicleId: string, overrides: Partial<VehicleSetup> = {}): VehicleSetup {
  return {
    id,
    vehicleId,
    templateId: "default-kart-template",
    name: id,
    unitSystem: "mm",
    tireBrand: "",
    psiMode: "single",
    psiFrontLeft: null,
    psiFrontRight: null,
    psiRearLeft: null,
    psiRearRight: null,
    tireWidthMode: "halves",
    tireWidthFrontLeft: null,
    tireWidthFrontRight: null,
    tireWidthRearLeft: null,
    tireWidthRearRight: null,
    tireDiameterMode: "halves",
    tireDiameterFrontLeft: null,
    tireDiameterFrontRight: null,
    tireDiameterRearLeft: null,
    tireDiameterRearRight: null,
    customFields: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("setupStorage CRUD", () => {
  it("saves, reads, and deletes a setup", async () => {
    await saveSetup(setup("s1", "v1"));
    expect(await getSetup("s1")).toMatchObject({ id: "s1", vehicleId: "v1" });
    await deleteSetup("s1");
    expect(await getSetup("s1")).toBeNull();
  });

  it("stamps updatedAt and lists newest-first", async () => {
    await saveSetup(setup("s1", "v1"));
    await new Promise((r) => setTimeout(r, 2));
    await saveSetup(setup("s2", "v1"));
    const list = await listSetups();
    expect(list.map((s) => s.id)).toEqual(["s2", "s1"]); // newest updatedAt first
  });

  it("emits garage events on save and delete", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await saveSetup(setup("s1", "v1"));
    await deleteSetup("s1");
    off();
    expect(seen).toHaveBeenNthCalledWith(1, { store: "setups", key: "s1", type: "put" });
    expect(seen).toHaveBeenNthCalledWith(2, { store: "setups", key: "s1", type: "delete" });
  });
});

describe("getLatestSetupForVehicle", () => {
  it("returns the most-recently-updated setup for a vehicle (via the index)", async () => {
    await saveSetup(setup("s1", "v1"));
    await new Promise((r) => setTimeout(r, 2));
    await saveSetup(setup("s2", "v1"));
    await saveSetup(setup("s3", "v2")); // different vehicle — must be ignored
    const latest = await getLatestSetupForVehicle("v1");
    expect(latest!.id).toBe("s2");
  });

  it("returns null when the vehicle has no setups", async () => {
    await saveSetup(setup("s1", "v1"));
    expect(await getLatestSetupForVehicle("v-none")).toBeNull();
  });
});
