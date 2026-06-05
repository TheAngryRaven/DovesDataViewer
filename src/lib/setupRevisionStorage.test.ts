/**
 * IndexedDB tests for setupRevisionStorage — immutable, content-addressed frozen
 * setups. Covers freeze (hash id), dedup/idempotency, a value change producing a
 * new revision, and the orphan prune (a revision no FileMetadata references is
 * swept). freezeSetupRevision spans the setups, templates, and metadata stores.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  freezeSetupRevision,
  getSetupRevision,
  listSetupRevisions,
  deleteSetupRevision,
  pruneSetupRevisions,
} from "./setupRevisionStorage";
import { saveSetup, type VehicleSetup } from "./setupStorage";
import { saveTemplate, type SetupTemplate } from "./templateStorage";
import { saveFileMetadata } from "./fileStorage";

beforeEach(() => freshIndexedDB());

const template: SetupTemplate = {
  id: "tpl1",
  vehicleTypeId: "vt1",
  name: "Kart",
  sections: [{ id: "sec1", name: "Alignment", fields: [{ id: "f-toe", name: "Toe", type: "number" }] }],
  wheelCount: 4,
  includeTires: true,
  isDefault: false,
  createdAt: 1,
  updatedAt: 1,
};

function setup(id: string, overrides: Partial<VehicleSetup> = {}): VehicleSetup {
  return {
    id,
    vehicleId: "v1",
    templateId: "tpl1",
    name: "Baseline",
    unitSystem: "mm",
    tireBrand: "MOJO",
    psiMode: "single",
    psiFrontLeft: 12,
    psiFrontRight: 12,
    psiRearLeft: 13,
    psiRearRight: 13,
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
    customFields: { "f-toe": 2 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("freezeSetupRevision", () => {
  it("freezes a live setup into a content-addressed revision", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const revId = await freezeSetupRevision("s1");
    expect(revId).toBeTruthy();
    const rev = await getSetupRevision(revId!);
    expect(rev).not.toBeNull();
    expect(rev!.setupId).toBe("s1");
    expect(rev!.id).toBe(revId);
    // Embeds a frozen copy of the template structure for stable rendering.
    expect(rev!.template?.sections[0].fields[0].name).toBe("Toe");
  });

  it("returns null when the setup no longer exists", async () => {
    expect(await freezeSetupRevision("missing")).toBeNull();
  });

  it("is idempotent — re-freezing identical content reuses the same revision", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const a = await freezeSetupRevision("s1");
    const b = await freezeSetupRevision("s1");
    expect(a).toBe(b);
    expect(await listSetupRevisions()).toHaveLength(1);
  });

  it("produces a new revision when a setup value changes", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const a = await freezeSetupRevision("s1");
    await saveSetup(setup("s1", { customFields: { "f-toe": 5 } })); // value changed
    const b = await freezeSetupRevision("s1");
    expect(b).not.toBe(a);
    expect(await listSetupRevisions()).toHaveLength(2);
  });
});

describe("pruneSetupRevisions (orphan sweep)", () => {
  it("deletes a revision that no session metadata references", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const revId = await freezeSetupRevision("s1");
    expect(await listSetupRevisions()).toHaveLength(1);

    const pruned = await pruneSetupRevisions();
    expect(pruned).toEqual([revId]);
    expect(await getSetupRevision(revId!)).toBeNull();
  });

  it("keeps a revision still referenced by a session's sessionSetupRev", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const revId = await freezeSetupRevision("s1");
    await saveFileMetadata({ fileName: "s.dove", trackName: "OKC", courseName: "CW", sessionSetupRev: revId! });

    const pruned = await pruneSetupRevisions();
    expect(pruned).toEqual([]);
    expect(await getSetupRevision(revId!)).not.toBeNull();
  });
});

describe("deleteSetupRevision", () => {
  it("removes a revision locally", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const revId = await freezeSetupRevision("s1");
    await deleteSetupRevision(revId!);
    expect(await getSetupRevision(revId!)).toBeNull();
  });
});
