import { describe, expect, it } from "vitest";
import type { VehicleSetup } from "./setupStorage";
import type { SetupTemplate } from "./templateStorage";
import {
  buildSetupRevision,
  computeSetupHash,
  findPrunableRevisionIds,
  freezeTemplate,
  REVISION_RETENTION_MS,
  shortRevHash,
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

describe("findPrunableRevisionIds (plan 0028 retention)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 100 * DAY;
  const rev = (id: string, setupId: string, ageDays: number) => ({ id, setupId, updatedAt: NOW - ageDays * DAY });

  it("never deletes a revision a session references, however old", () => {
    const revs = [rev("a", "s", 30), rev("b", "s", 20), rev("c", "s", 10)];
    expect(findPrunableRevisionIds(revs, ["a", "b"], ["s"], NOW)).toEqual([]);
  });

  it("keeps unreferenced revisions younger than the retention window", () => {
    const revs = [rev("a", "s", 2.9), rev("b", "s", 1), rev("c", "s", 0)];
    expect(findPrunableRevisionIds(revs, [], ["s"], NOW)).toEqual([]);
  });

  it("deletes aged unreferenced revisions but keeps the newest unreferenced one of a live setup", () => {
    const revs = [rev("a", "s", 10), rev("b", "s", 7), rev("c", "s", 4)];
    expect(findPrunableRevisionIds(revs, [], ["s"], NOW)).toEqual(["a", "b"]);
  });

  it("keeps the newest unreferenced revision even when a newer referenced one exists", () => {
    // The user's choice: scrub-back to the last untagged state survives.
    const revs = [rev("a", "s", 10), rev("b", "s", 7), rev("c", "s", 4)];
    expect(findPrunableRevisionIds(revs, ["c"], ["s"], NOW)).toEqual(["a"]);
  });

  it("deletes every aged unreferenced revision of a deleted setup", () => {
    const revs = [rev("a", "gone", 10), rev("b", "gone", 4), rev("c", "gone", 1)];
    expect(findPrunableRevisionIds(revs, [], [], NOW)).toEqual(["a", "b"]);
  });

  it("judges age by updatedAt, so a re-saved revision is fresh again", () => {
    const revs = [rev("old", "s", 10), rev("resaved", "s", 0.5), rev("mid", "s", 5)];
    // "mid" is not the newest unreferenced (resaved is), and it aged out.
    expect(findPrunableRevisionIds(revs, [], ["s"], NOW)).toEqual(["old", "mid"]);
  });

  it("treats the boundary as aged out and honours a custom window", () => {
    const revs = [rev("a", "s", 3), rev("b", "s", 0)];
    expect(REVISION_RETENTION_MS).toBe(3 * DAY);
    expect(findPrunableRevisionIds(revs, [], ["s"], NOW)).toEqual(["a"]);
    expect(findPrunableRevisionIds(revs, [], ["s"], NOW, 5 * DAY)).toEqual([]);
  });

  it("ignores references to revisions that no longer exist", () => {
    expect(findPrunableRevisionIds([rev("a", "s", 10), rev("b", "s", 5)], ["ghost"], ["s"], NOW)).toEqual(["a"]);
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
