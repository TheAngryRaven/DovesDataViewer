import { describe, it, expect } from "vitest";
import { getSetupIndicator } from "./setupStatus";

describe("getSetupIndicator", () => {
  it("returns null once the session has a setup assigned", () => {
    expect(getSetupIndicator({ sessionSetupId: "abc", setupCount: 0, vehicleCount: 0 })).toBeNull();
    expect(getSetupIndicator({ sessionSetupId: "abc", setupCount: 3, vehicleCount: 2 })).toBeNull();
  });

  it("glows red → vehicles when nothing exists at all", () => {
    expect(getSetupIndicator({ sessionSetupId: null, setupCount: 0, vehicleCount: 0 })).toEqual({
      tone: "red",
      target: "vehicles",
    });
  });

  it("glows red → setups when a vehicle exists but no setup does", () => {
    expect(getSetupIndicator({ sessionSetupId: null, setupCount: 0, vehicleCount: 1 })).toEqual({
      tone: "red",
      target: "setups",
    });
  });

  it("glows orange → notes when setups exist but this session isn't linked", () => {
    expect(getSetupIndicator({ sessionSetupId: null, setupCount: 2, vehicleCount: 1 })).toEqual({
      tone: "orange",
      target: "notes",
    });
  });
});
