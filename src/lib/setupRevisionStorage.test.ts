/**
 * IndexedDB tests for setupRevisionStorage — immutable, content-addressed frozen
 * setups. Covers freeze (hash id), dedup/idempotency, a value change producing a
 * new revision, the dedup updatedAt bump, and the retention sweep (an
 * unreferenced revision is swept once it is older than REVISION_RETENTION_MS and
 * isn't the newest unreferenced one of a live setup — plan 0028).
 * freezeSetupRevision spans the setups, templates, and metadata stores.
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
import { saveSetup, deleteSetup, type VehicleSetup } from "./setupStorage";
import { saveTemplate, type SetupTemplate } from "./templateStorage";
import { saveFileMetadata } from "./fileStorage";
import { REVISION_RETENTION_MS } from "./setupRevision";

const DAY = 24 * 60 * 60 * 1000;

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

  it("bumps updatedAt (not createdAt) when a re-freeze dedups onto an existing revision", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const id = await freezeSetupRevision("s1", 1_000);
    await freezeSetupRevision("s1", 5_000);
    const rev = await getSetupRevision(id!);
    expect(rev!.createdAt).toBe(1_000);
    expect(rev!.updatedAt).toBe(5_000);
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

describe("pruneSetupRevisions (retention sweep)", () => {
  const NOW = 100 * DAY;

  it("deletes aged unreferenced revisions, keeping fresh ones and the newest unreferenced of a live setup", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const a = await freezeSetupRevision("s1", NOW - 10 * DAY);
    await saveSetup(setup("s1", { customFields: { "f-toe": 5 } }));
    const b = await freezeSetupRevision("s1", NOW - 5 * DAY);
    await saveSetup(setup("s1", { customFields: { "f-toe": 6 } }));
    const c = await freezeSetupRevision("s1", NOW - 1 * DAY);

    const pruned = await pruneSetupRevisions(NOW);
    expect(pruned.sort()).toEqual([a, b].sort());
    expect(await getSetupRevision(c!)).not.toBeNull();
  });

  it("keeps the newest unreferenced revision of a live setup however old it is", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const a = await freezeSetupRevision("s1", NOW - 30 * DAY);
    await saveSetup(setup("s1", { customFields: { "f-toe": 5 } }));
    const b = await freezeSetupRevision("s1", NOW - 20 * DAY);

    expect(await pruneSetupRevisions(NOW)).toEqual([a]);
    expect(await getSetupRevision(b!)).not.toBeNull();
  });

  it("deletes every aged unreferenced revision once its live setup is gone", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const a = await freezeSetupRevision("s1", NOW - 10 * DAY);
    await saveSetup(setup("s1", { customFields: { "f-toe": 5 } }));
    const b = await freezeSetupRevision("s1", NOW - 4 * DAY);
    await deleteSetup("s1");

    const pruned = await pruneSetupRevisions(NOW);
    expect(pruned.sort()).toEqual([a, b].sort());
  });

  it("keeps a revision still referenced by a session's sessionSetupRev after its setup is deleted", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const revId = await freezeSetupRevision("s1", NOW - 30 * DAY);
    await saveFileMetadata({ fileName: "s.dove", trackName: "OKC", courseName: "CW", sessionSetupRev: revId! });
    await deleteSetup("s1");

    const pruned = await pruneSetupRevisions(NOW);
    expect(pruned).toEqual([]);
    expect(await getSetupRevision(revId!)).not.toBeNull();
  });

  it("uses the 3-day window", async () => {
    await saveTemplate(template);
    await saveSetup(setup("s1"));
    const a = await freezeSetupRevision("s1", NOW - REVISION_RETENTION_MS);
    await saveSetup(setup("s1", { customFields: { "f-toe": 5 } }));
    await freezeSetupRevision("s1", NOW - REVISION_RETENTION_MS + 1);
    await saveSetup(setup("s1", { customFields: { "f-toe": 6 } }));
    await freezeSetupRevision("s1", NOW);

    expect(await pruneSetupRevisions(NOW)).toEqual([a]);
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
