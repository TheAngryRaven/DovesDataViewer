import { describe, expect, it } from "vitest";
import type { VehicleSetup } from "./setupStorage";
import type { SetupTemplate } from "./templateStorage";
import {
  buildSetupRevision,
  computeSetupHash,
  findOrphanRevisionIds,
  freezeTemplate,
  PRUNE_INTERVAL_MS,
  shortRevHash,
  shouldPrune,
  SHORT_HASH_LENGTH,
} from "./setupRevision";

function makeSetup(overrides: Partial<VehicleSetup> = {}): VehicleSetup {
  return {
    id: "setup-1",
    vehicleId: "veh-1",
    templateId: "tpl-1",
    name: "Race Day Dry",
    unitSystem: "mm",
    tireBrand: "MG",
    psiMode: "single",
    psiFrontLeft: 12,
    psiFrontRight: 12,
    psiRearLeft: 12,
    psiRearRight: 12,
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
    customFields: { "f-toe": 1, "f-camber": -2 },
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

const template: SetupTemplate = {
  id: "tpl-1",
  vehicleTypeId: "vt-1",
  name: "Kart",
  sections: [
    { id: "sec-a", name: "Alignment", fields: [
      { id: "f-toe", name: "Toe", type: "number" },
      { id: "f-camber", name: "Camber", type: "number" },
    ] },
  ],
  wheelCount: 4,
  includeTires: true,
  isDefault: false,
  createdAt: 0,
  updatedAt: 0,
};

describe("computeSetupHash", () => {
  it("is deterministic for identical content", async () => {
    const a = await computeSetupHash(makeSetup(), template);
    const b = await computeSetupHash(makeSetup(), template);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores volatile bookkeeping (id, createdAt, updatedAt)", async () => {
    const base = await computeSetupHash(makeSetup(), template);
    const moved = await computeSetupHash(
      makeSetup({ id: "setup-99", createdAt: 9999, updatedAt: 8888 }),
      template,
    );
    expect(moved).toBe(base);
  });

  it("is independent of customFields key order", async () => {
    const a = await computeSetupHash(makeSetup({ customFields: { "f-toe": 1, "f-camber": -2 } }), template);
    const b = await computeSetupHash(makeSetup({ customFields: { "f-camber": -2, "f-toe": 1 } }), template);
    expect(a).toBe(b);
  });

  it("changes when a setup value changes", async () => {
    const base = await computeSetupHash(makeSetup(), template);
    const edited = await computeSetupHash(makeSetup({ customFields: { "f-toe": 2, "f-camber": -2 } }), template);
    expect(edited).not.toBe(base);
  });

  it("changes when the setup name changes", async () => {
    const base = await computeSetupHash(makeSetup(), template);
    const renamed = await computeSetupHash(makeSetup({ name: "Race Day Wet" }), template);
    expect(renamed).not.toBe(base);
  });

  it("changes when the template structure changes (a renamed field)", async () => {
    const base = await computeSetupHash(makeSetup(), template);
    const renamedField: SetupTemplate = {
      ...template,
      sections: [{ ...template.sections[0], fields: [
        { id: "f-toe", name: "Toe (front)", type: "number" },
        { id: "f-camber", name: "Camber", type: "number" },
      ] }],
    };
    const after = await computeSetupHash(makeSetup(), renamedField);
    expect(after).not.toBe(base);
  });

  it("differs from the same values under no template", async () => {
    const withTpl = await computeSetupHash(makeSetup(), template);
    const without = await computeSetupHash(makeSetup(), null);
    expect(without).not.toBe(withTpl);
  });
});

describe("shortRevHash", () => {
  it("returns the leading hex prefix", async () => {
    const hash = await computeSetupHash(makeSetup(), template);
    expect(shortRevHash(hash)).toBe(hash.slice(0, SHORT_HASH_LENGTH));
    expect(shortRevHash(hash)).toHaveLength(SHORT_HASH_LENGTH);
  });
});

describe("freezeTemplate", () => {
  it("keeps structure but drops input hints (min/max/step)", () => {
    const frozen = freezeTemplate({
      ...template,
      sections: [{ id: "s", name: "S", fields: [
        { id: "f", name: "F", type: "number", unit: "mm", min: 0, max: 5, step: 0.5 },
      ] }],
    });
    expect(frozen?.sections[0].fields[0]).toEqual({ id: "f", name: "F", type: "number", unit: "mm" });
  });

  it("returns null for a missing template", () => {
    expect(freezeTemplate(null)).toBeNull();
    expect(freezeTemplate(undefined)).toBeNull();
  });
});

describe("findOrphanRevisionIds", () => {
  it("returns revisions no session references", () => {
    const orphans = findOrphanRevisionIds(["a", "b", "c"], ["b"]);
    expect(orphans.sort()).toEqual(["a", "c"]);
  });

  it("keeps every referenced revision", () => {
    expect(findOrphanRevisionIds(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("treats everything as an orphan when nothing is referenced", () => {
    expect(findOrphanRevisionIds(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("ignores references to revisions that no longer exist", () => {
    expect(findOrphanRevisionIds(["a"], ["a", "ghost"])).toEqual([]);
  });
});

describe("shouldPrune", () => {
  it("runs when never run before", () => {
    expect(shouldPrune(null, 1000)).toBe(true);
    expect(shouldPrune(undefined, 1000)).toBe(true);
  });

  it("waits until the interval has elapsed", () => {
    const last = 1_000_000;
    expect(shouldPrune(last, last + PRUNE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldPrune(last, last + PRUNE_INTERVAL_MS)).toBe(true);
  });
});

describe("buildSetupRevision", () => {
  it("uses the content hash as its id and records lineage", async () => {
    const setup = makeSetup();
    const rev = await buildSetupRevision({ setup, template, now: 4242 });
    expect(rev.id).toBe(await computeSetupHash(setup, template));
    expect(rev.setupId).toBe(setup.id);
    expect(rev.vehicleId).toBe(setup.vehicleId);
    expect(rev.name).toBe(setup.name);
    expect(rev.createdAt).toBe(4242);
    expect(rev.updatedAt).toBe(4242);
    expect(rev.template?.id).toBe(template.id);
    expect(rev.setup).toEqual(setup);
  });

  it("two unchanged setups freeze to the same id (dedup)", async () => {
    const a = await buildSetupRevision({ setup: makeSetup(), template, now: 1 });
    const b = await buildSetupRevision({ setup: makeSetup({ id: "other" }), template, now: 2 });
    expect(a.id).toBe(b.id);
  });
});
