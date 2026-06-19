import { describe, expect, it } from "vitest";
import type { VehicleSetup } from "./setupStorage";
import type { SetupRevision, FrozenTemplate } from "./setupRevision";
import type { FileMetadata } from "./fileStorage";
import type { Vehicle } from "./vehicleStorage";
import { buildVehicleHistory } from "./vehicleHistory";

const TEMPLATE: FrozenTemplate = {
  id: "tpl-1",
  name: "Kart",
  wheelCount: 4,
  includeTires: true,
  sections: [
    {
      id: "sec",
      name: "Alignment",
      fields: [{ id: "f-toe", name: "Toe", type: "number" }],
    },
  ],
};

function makeSetup(name: string, overrides: Partial<VehicleSetup> = {}): VehicleSetup {
  return {
    id: "setup-1",
    vehicleId: "veh-1",
    templateId: "tpl-1",
    name,
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
    customFields: { "f-toe": 1 },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeRevision(id: string, createdAt: number, setup: VehicleSetup): SetupRevision {
  return {
    id,
    setupId: setup.id,
    vehicleId: setup.vehicleId,
    name: setup.name,
    setup,
    template: TEMPLATE,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeMeta(overrides: Partial<FileMetadata> & { fileName: string }): FileMetadata {
  return { trackName: "", courseName: "", ...overrides };
}

const VEHICLES: Vehicle[] = [
  { id: "veh-1", name: "Kart #7", vehicleTypeId: "vt", engine: "X30", number: 7, weight: 80, weightUnit: "kg" },
  { id: "veh-2", name: "Kart #9", vehicleTypeId: "vt", engine: "KA100", number: 9, weight: 82, weightUnit: "kg" },
];

const revDry = makeRevision("rev-dry", 1000, makeSetup("Dry", { customFields: { "f-toe": 1 } }));
const revWet = makeRevision("rev-wet", 2000, makeSetup("Wet", { customFields: { "f-toe": 2 } }));

const metas = [
  // veh-1 / Dry / Track A CW — 65000
  makeMeta({ fileName: "s1", sessionSetupRev: "rev-dry", sessionKartId: "veh-1", trackName: "Track A", courseName: "CW", fastestLapMs: 65000, sessionStartTime: 100 }),
  // veh-1 / Wet / Track A CW — 61000 (fastest overall on veh-1)
  makeMeta({ fileName: "s2", sessionSetupRev: "rev-wet", sessionKartId: "veh-1", trackName: "Track A", courseName: "CW", fastestLapMs: 61000, sessionStartTime: 200 }),
  // veh-1 / Dry / Track B CCW — 63000
  makeMeta({ fileName: "s3", sessionSetupRev: "rev-dry", sessionKartId: "veh-1", trackName: "Track B", courseName: "CCW", fastestLapMs: 63000, sessionStartTime: 300 }),
  // veh-2 session — must never appear in veh-1's history
  makeMeta({ fileName: "s4", sessionSetupRev: "rev-wet", sessionKartId: "veh-2", trackName: "Track A", courseName: "CW", fastestLapMs: 50000, sessionStartTime: 400 }),
];

describe("buildVehicleHistory", () => {
  it("orders cards fastest lap first and flags the overall fastest", () => {
    const h = buildVehicleHistory({ vehicleId: "veh-1", vehicleName: "Kart #7", revisions: [revWet, revDry], metas, vehicles: VEHICLES });
    expect(h.entries.map((e) => e.revision.id)).toEqual(["rev-wet", "rev-dry"]);
    expect(h.entries[0].fastestLapMs).toBe(61000);
    // rev-dry's fastest across its sessions on veh-1 (65000, 63000) is 63000
    expect(h.entries[1].fastestLapMs).toBe(63000);
    expect(h.overallFastestLapMs).toBe(61000);
    expect(h.entries[0].isFastestOverall).toBe(true);
    expect(h.entries[1].isFastestOverall).toBe(false);
  });

  it("only includes sessions run on this vehicle", () => {
    const h = buildVehicleHistory({ vehicleId: "veh-1", vehicleName: "Kart #7", revisions: [revWet, revDry], metas, vehicles: VEHICLES });
    const allFiles = h.entries.flatMap((e) => e.usages.map((u) => u.fileName));
    expect(allFiles).not.toContain("s4");
    expect(allFiles.sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("exposes course filter options across the vehicle", () => {
    const h = buildVehicleHistory({ vehicleId: "veh-1", vehicleName: "Kart #7", revisions: [revWet, revDry], metas, vehicles: VEHICLES });
    expect(h.courseOptions.map((c) => c.label)).toContain("Track A — CW");
    expect(h.courseOptions.map((c) => c.label)).toContain("Track B — CCW");
  });

  it("filters by course, dropping revisions with no matching session", () => {
    const courseKey = `Track B\x1fCCW`;
    const h = buildVehicleHistory({
      vehicleId: "veh-1",
      vehicleName: "Kart #7",
      revisions: [revWet, revDry],
      metas,
      vehicles: VEHICLES,
      filter: { courseKey },
    });
    // Only Dry ran on Track B CCW
    expect(h.entries.map((e) => e.revision.id)).toEqual(["rev-dry"]);
    expect(h.entries[0].fastestLapMs).toBe(63000);
  });

  it("flattens the frozen setup for the collapsible body", () => {
    const h = buildVehicleHistory({ vehicleId: "veh-1", vehicleName: "Kart #7", revisions: [revWet, revDry], metas, vehicles: VEHICLES });
    const wet = h.entries.find((e) => e.revision.id === "rev-wet")!;
    expect(wet.setupName).toBe("Wet");
    expect(wet.fields.find((f) => f.key === "tpl:f-toe")?.value).toBe(2);
  });

  it("skips sessions whose frozen revision is no longer in the store", () => {
    const h = buildVehicleHistory({ vehicleId: "veh-1", vehicleName: "Kart #7", revisions: [revWet], metas, vehicles: VEHICLES });
    // rev-dry pruned → only rev-wet survives
    expect(h.entries.map((e) => e.revision.id)).toEqual(["rev-wet"]);
  });
});
