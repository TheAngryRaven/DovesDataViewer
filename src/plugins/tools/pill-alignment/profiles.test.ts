import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, eccentricityFromSweep, forwardCorner, neutralFromMeasured } from "./model";
import {
  BUILTIN_PROFILES,
  findProfile,
  makeUserProfile,
  migrateProfileId,
  removeUserProfile,
  upsertUserProfile,
  type ChassisProfile,
} from "./profiles";

describe("built-in profiles", () => {
  it("cover the supported brands with valid calibrations", () => {
    const ids = BUILTIN_PROFILES.map((p) => p.id);
    for (const brand of ["generic", "otk", "kart-republic", "compkart", "birel-art", "praga", "sodi"]) {
      expect(ids).toContain(brand);
    }
    for (const p of BUILTIN_PROFILES) {
      expect(p.source).toBe("estimated");
      expect(p.cal.eMm[0]).toBe(0);
      expect(p.cal.eMm).toHaveLength(6);
      expect(p.cal.hMm).toBeGreaterThan(0);
    }
  });

  it("have unique ids", () => {
    const ids = BUILTIN_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("profile lookup & migration", () => {
  it("finds user profiles before built-ins and falls back to built-ins", () => {
    const user: ChassisProfile = { id: "user-x", name: "X", source: "measured", cal: DEFAULT_CALIBRATION };
    expect(findProfile("user-x", [user])).toBe(user);
    expect(findProfile("praga", [user])?.name).toBe("Praga");
    expect(findProfile("nope", [user])).toBeNull();
    expect(findProfile(null, [user])).toBeNull();
  });

  it("migrates the legacy preset id and passes others through", () => {
    expect(migrateProfileId("otk-approx")).toBe("otk");
    expect(migrateProfileId("praga")).toBe("praga");
    expect(migrateProfileId(null)).toBeNull();
    expect(migrateProfileId(undefined)).toBeNull();
  });
});

describe("user profile CRUD", () => {
  it("makeUserProfile slugs the name and marks it measured", () => {
    const p = makeUserProfile("My Praga — July 2026", DEFAULT_CALIBRATION, []);
    expect(p.id).toBe("user-my-praga-july-2026");
    expect(p.name).toBe("My Praga — July 2026");
    expect(p.source).toBe("measured");
  });

  it("deduplicates ids against built-ins and existing user profiles", () => {
    const first = makeUserProfile("Praga", DEFAULT_CALIBRATION, []);
    const second = makeUserProfile("Praga", DEFAULT_CALIBRATION, [first]);
    expect(first.id).not.toBe(second.id);
    expect(second.id).toBe("user-praga-2");
  });

  it("snapshots the calibration (later edits don't leak into the profile)", () => {
    const cal = { ...DEFAULT_CALIBRATION, eMm: [...DEFAULT_CALIBRATION.eMm] as typeof DEFAULT_CALIBRATION.eMm };
    const p = makeUserProfile("Snap", cal, []);
    cal.eMm[3] = 99;
    expect(p.cal.eMm[3]).not.toBe(99);
  });

  it("upsert replaces same-id entries and sorts by name; remove filters", () => {
    const a = makeUserProfile("Bravo", DEFAULT_CALIBRATION, []);
    const b = makeUserProfile("Alpha", DEFAULT_CALIBRATION, [a]);
    let list = upsertUserProfile([a], b);
    expect(list.map((p) => p.name)).toEqual(["Alpha", "Bravo"]);
    list = upsertUserProfile(list, { ...a, name: "Zulu" });
    expect(list.map((p) => p.name)).toEqual(["Alpha", "Zulu"]);
    expect(removeUserProfile(list, a.id).map((p) => p.name)).toEqual(["Alpha"]);
  });
});

describe("measurement helpers", () => {
  it("eccentricityFromSweep halves the indicator sweep and clamps negatives", () => {
    expect(eccentricityFromSweep(3)).toBe(1.5);
    expect(eccentricityFromSweep(-1)).toBe(0);
  });

  it("neutralFromMeasured round-trips through the forward model at size 0", () => {
    const measured = { camberDeg: -0.7, casterDeg: 2.3 };
    const { nXMm, nYMm } = neutralFromMeasured(DEFAULT_CALIBRATION, measured.camberDeg, measured.casterDeg);
    const cal = { ...DEFAULT_CALIBRATION, nXMm, nYMm, gamma0Deg: 0 };
    const r = forwardCorner(cal, { sTop: 0, sBot: 0, thetaTopDeg: 0, thetaBotDeg: 0 }, "left");
    expect(r.camberDeg).toBeCloseTo(measured.camberDeg, 6);
    expect(r.casterDeg).toBeCloseTo(measured.casterDeg, 6);
  });

  it("neutralFromMeasured respects flipped sign conventions", () => {
    const flipped = { ...DEFAULT_CALIBRATION, signCamber: -1 as const, signCaster: -1 as const };
    const { nXMm, nYMm } = neutralFromMeasured(flipped, -0.7, 2.3);
    const cal = { ...flipped, nXMm, nYMm, gamma0Deg: 0 };
    const r = forwardCorner(cal, { sTop: 0, sBot: 0, thetaTopDeg: 0, thetaBotDeg: 0 }, "left");
    expect(r.camberDeg).toBeCloseTo(-0.7, 6);
    expect(r.casterDeg).toBeCloseTo(2.3, 6);
  });
});
