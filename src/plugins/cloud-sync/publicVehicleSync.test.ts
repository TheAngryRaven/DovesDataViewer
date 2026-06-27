import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Vehicle } from "@/lib/vehicleStorage";

// Capture the calls the projection makes against the public_vehicles builder.
const { state } = vi.hoisted(() => ({
  state: {
    vehicle: null as Vehicle | null,
    typeName: "Shifter Kart" as string | null,
    upsertArg: undefined as Record<string, unknown> | undefined,
    deleted: [] as Array<Record<string, string>>,
  },
}));

vi.mock("@/lib/vehicleStorage", () => ({
  getVehicle: async () => state.vehicle,
}));
vi.mock("@/lib/templateStorage", () => ({
  getVehicleType: async () => (state.typeName === null ? null : { id: "vt1", name: state.typeName }),
}));
vi.mock("./cloudClient", () => {
  const deleteBuilder = {
    _eqs: {} as Record<string, string>,
    eq(col: string, val: string) {
      this._eqs[col] = val;
      return this;
    },
    then(onFulfilled: (v: unknown) => unknown) {
      state.deleted.push({ ...this._eqs });
      return onFulfilled({ error: null });
    },
  };
  return {
    publicVehicles: () => ({
      upsert: (arg: Record<string, unknown>) => {
        state.upsertArg = arg;
        return Promise.resolve({ error: null });
      },
      delete: () => {
        deleteBuilder._eqs = {};
        return deleteBuilder;
      },
    }),
  };
});

import { syncPublicVehicle } from "./publicVehicleSync";

const baseVehicle: Vehicle = {
  id: "v1",
  name: "Kart 7",
  vehicleTypeId: "vt1",
  engine: "IAME X30",
  number: 7,
  weight: 165,
  weightUnit: "lb",
  publicProfile: true,
};

beforeEach(() => {
  state.vehicle = { ...baseVehicle };
  state.typeName = "Shifter Kart";
  state.upsertArg = undefined;
  state.deleted = [];
});

describe("syncPublicVehicle", () => {
  it("upserts only public-safe columns for a flagged vehicle (never weight)", async () => {
    await syncPublicVehicle("u1", { store: "karts", key: "v1", type: "put" });
    expect(state.upsertArg).toMatchObject({
      user_id: "u1",
      vehicle_id: "v1",
      name: "Kart 7",
      type_name: "Shifter Kart",
      engine: "IAME X30",
      number: 7,
    });
    expect(state.upsertArg).not.toHaveProperty("weight");
    expect(state.upsertArg).not.toHaveProperty("weightUnit");
    expect(state.deleted).toHaveLength(0);
  });

  it("deletes the public row when the vehicle is not flagged", async () => {
    state.vehicle = { ...baseVehicle, publicProfile: false };
    await syncPublicVehicle("u1", { store: "karts", key: "v1", type: "put" });
    expect(state.upsertArg).toBeUndefined();
    expect(state.deleted).toEqual([{ user_id: "u1", vehicle_id: "v1" }]);
  });

  it("deletes the public row when the vehicle no longer exists", async () => {
    state.vehicle = null;
    await syncPublicVehicle("u1", { store: "karts", key: "v1", type: "put" });
    expect(state.upsertArg).toBeUndefined();
    expect(state.deleted).toEqual([{ user_id: "u1", vehicle_id: "v1" }]);
  });

  it("deletes the public row on a vehicle delete", async () => {
    await syncPublicVehicle("u1", { store: "karts", key: "v1", type: "delete" });
    expect(state.upsertArg).toBeUndefined();
    expect(state.deleted).toEqual([{ user_id: "u1", vehicle_id: "v1" }]);
  });

  it("tolerates a missing vehicle type (null type_name)", async () => {
    state.typeName = null;
    await syncPublicVehicle("u1", { store: "karts", key: "v1", type: "put" });
    expect(state.upsertArg).toMatchObject({ type_name: null });
  });
});
