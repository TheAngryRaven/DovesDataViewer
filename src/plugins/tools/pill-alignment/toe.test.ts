import { describe, expect, it } from "vitest";
import type { SetupTemplate } from "@/lib/templateStorage";
import { DEFAULT_CALIBRATION, DEFAULT_TOE } from "./model";
import { effectiveToeMm, resolveSetupAlignmentFields, toeDegFromMm, toeDegFromRod, toeMmFromDeg } from "./toe";

describe("toe conversions", () => {
  it("rod→deg→mm round-trips through the arm and rim spans", () => {
    const deg = toeDegFromRod(2, 70);
    expect(deg).toBeCloseTo(Math.atan(2 / 70) * (180 / Math.PI), 9);
    const mm = toeMmFromDeg(deg, 130);
    expect(toeDegFromMm(mm, 130)).toBeCloseTo(deg, 9);
  });

  it("toe OUT is negative end to end", () => {
    expect(toeDegFromRod(-2, 70)).toBeLessThan(0);
    expect(toeMmFromDeg(-1, 130)).toBeLessThan(0);
  });

  it("guards zero/negative geometry", () => {
    expect(toeDegFromRod(2, 0)).toBe(0);
    expect(toeDegFromMm(2, 0)).toBe(0);
  });

  it("effectiveToeMm follows the active mode", () => {
    const cal = DEFAULT_CALIBRATION;
    expect(effectiveToeMm({ ...DEFAULT_TOE, mode: "perSide", leftToeMm: -2, rightToeMm: -1 }, "left", cal)).toBe(-2);
    expect(effectiveToeMm({ ...DEFAULT_TOE, mode: "perSide", leftToeMm: -2, rightToeMm: -1 }, "right", cal)).toBe(-1);
    const rod = effectiveToeMm({ ...DEFAULT_TOE, mode: "rod", rodDeltaMm: 2, rArmMm: 70 }, "left", cal);
    expect(rod).toBeCloseTo(toeMmFromDeg(toeDegFromRod(2, 70), cal.lRimMm), 9);
  });
});

describe("resolveSetupAlignmentFields", () => {
  it("reads default-template ids without a template", () => {
    const values = resolveSetupAlignmentFields(null, {
      "f-toe": -2,
      "f-camber": "-0.9",
      "f-castor": 2.5,
      "f-front-width": 1180,
    });
    expect(values).toEqual({ toe: -2, camber: -0.9, castor: 2.5, frontWidthMm: 1180 });
  });

  it("matches custom-template fields by name, number fields only", () => {
    const template: SetupTemplate = {
      id: "t1",
      vehicleTypeId: "v1",
      name: "Custom",
      wheelCount: 4,
      includeTires: false,
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      sections: [
        {
          id: "s1",
          name: "Front",
          fields: [
            { id: "abc", name: "Toe (mm)", type: "number" },
            { id: "def", name: "Caster", type: "number" },
            { id: "ghi", name: "Camber notes", type: "string" },
            { id: "jkl", name: "camber", type: "number" },
          ],
        },
      ],
    };
    const values = resolveSetupAlignmentFields(template, { abc: -1.5, def: 2, ghi: "3", jkl: -0.8 });
    expect(values.toe).toBe(-1.5);
    expect(values.castor).toBe(2);
    expect(values.camber).toBe(-0.8);
    expect(values.frontWidthMm).toBeNull();
  });

  it("returns nulls for absent or non-numeric values", () => {
    const values = resolveSetupAlignmentFields(null, { "f-toe": "not a number", "f-camber": null });
    expect(values).toEqual({ toe: null, camber: null, castor: null, frontWidthMm: null });
  });
});
