import { describe, expect, it } from "vitest";
import type { VehicleSetup } from "./setupStorage";
import type { SetupRevision, FrozenTemplate } from "./setupRevision";
import type { FileMetadata } from "./fileStorage";
import type { Vehicle } from "./vehicleStorage";
import {
  buildSetupHistory,
  diffRevisionFields,
  flattenRevisionFields,
} from "./setupHistory";

const TEMPLATE: FrozenTemplate = {
  id: "tpl-1",
  name: "Kart",
  wheelCount: 4,
  includeTires: true,
  sections: [
    {
      id: "sec",
      name: "Alignment",
      fields: [
        { id: "f-toe", name: "Toe", type: "number" },
        { id: "f-camber", name: "Camber", type: "number" },
        { id: "f-front-sprocket", name: "Front Sprocket", type: "number" },
        { id: "f-rear-sprocket", name: "Rear Sprocket", type: "number" },
        { id: "f-front-width", name: "Front Width", type: "number", unit: "mm" },
      ],
    },
  ],
};

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
    customFields: { "f-toe": 1, "f-camber": -2, "f-front-sprocket": 11, "f-rear-sprocket": 82, "f-front-width": 1380 },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeRevision(id: string, createdAt: number, setup: VehicleSetup): SetupRevision {
  return {
    id,
    setupId: "setup-1",
    vehicleId: "veh-1",
    name: setup.name,
    setup,
    template: TEMPLATE,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeMeta(overrides: Partial<FileMetadata> & { fileName: string }): FileMetadata {
  return {
    trackName: "",
    courseName: "",
    ...overrides,
  };
}

const VEHICLES: Vehicle[] = [
  { id: "veh-1", name: "Kart #7", vehicleTypeId: "vt", engine: "X30", number: 7, weight: 80, weightUnit: "kg" },
  { id: "veh-2", name: "Kart #9", vehicleTypeId: "vt", engine: "KA100", number: 9, weight: 82, weightUnit: "kg" },
];

describe("flattenRevisionFields", () => {
  it("flattens template fields, derived ratio, and tire data", () => {
    const fields = flattenRevisionFields(makeRevision("a", 1, makeSetup()));
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey["tpl:f-toe"].value).toBe(1);
    expect(byKey["tpl:f-camber"].value).toBe(-2);
    expect(byKey["tpl:f-front-width"].unit).toBe("mm");
    // 82/11 = 7.454...
    expect(byKey["ratio"].display).toBe("7.455");
    expect(byKey["tireBrand"].value).toBe("MG");
    // single PSI collapses to one "all" field
    expect(byKey["psiAll"].display).toBe("12.00");
    expect(byKey["psiFront"]).toBeUndefined();
  });

  it("skips empty/zero template values", () => {
    const fields = flattenRevisionFields(
      makeRevision("a", 1, makeSetup({ customFields: { "f-toe": 1 } })),
    );
    expect(fields.find((f) => f.key === "tpl:f-camber")).toBeUndefined();
    expect(fields.find((f) => f.key === "ratio")).toBeUndefined();
  });

  it("splits PSI into front/rear when halves differ", () => {
    const fields = flattenRevisionFields(
      makeRevision("a", 1, makeSetup({ psiFrontLeft: 11, psiFrontRight: 11, psiRearLeft: 13, psiRearRight: 13 })),
    );
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("psiFront");
    expect(keys).toContain("psiRear");
    expect(keys).not.toContain("psiAll");
  });
});

describe("diffRevisionFields", () => {
  it("reports numeric direction and added/removed fields", () => {
    const prev = flattenRevisionFields(makeRevision("a", 1, makeSetup({ customFields: { "f-toe": 1, "f-camber": -2 } })));
    const next = flattenRevisionFields(
      makeRevision("b", 2, makeSetup({ customFields: { "f-toe": 3, "f-rear-sprocket": 80, "f-front-sprocket": 11 } })),
    );
    const diff = diffRevisionFields(prev, next);
    const byKey = Object.fromEntries(diff.map((d) => [d.key, d]));
    // toe 1 → 3 increased
    expect(byKey["tpl:f-toe"].direction).toBe("up");
    // camber present before, gone now → removed
    expect(byKey["tpl:f-camber"].nextDisplay).toBeNull();
    // ratio added (sprockets now present)
    expect(byKey["ratio"].prevDisplay).toBeNull();
  });

  it("omits unchanged fields", () => {
    const fields = flattenRevisionFields(makeRevision("a", 1, makeSetup()));
    expect(diffRevisionFields(fields, fields)).toEqual([]);
  });

  it("flags a decrease as down", () => {
    const prev = flattenRevisionFields(makeRevision("a", 1, makeSetup()));
    const next = flattenRevisionFields(makeRevision("b", 2, makeSetup({ psiFrontLeft: 10, psiFrontRight: 10, psiRearLeft: 10, psiRearRight: 10 })));
    const diff = diffRevisionFields(prev, next);
    expect(diff.find((d) => d.key === "psiAll")?.direction).toBe("down");
  });
});

describe("buildSetupHistory", () => {
  const revA = makeRevision("rev-a", 1000, makeSetup({ customFields: { "f-toe": 1 } }));
  const revB = makeRevision("rev-b", 2000, makeSetup({ customFields: { "f-toe": 2 } }));
  const revs = [revB, revA]; // intentionally unsorted

  const metas = [
    makeMeta({ fileName: "s1", sessionSetupRev: "rev-a", sessionKartId: "veh-1", trackName: "Track A", courseName: "CW", fastestLapMs: 65000, sessionStartTime: 100 }),
    makeMeta({ fileName: "s2", sessionSetupRev: "rev-a", sessionKartId: "veh-2", trackName: "Track B", courseName: "CCW", fastestLapMs: 63000, sessionStartTime: 200 }),
    makeMeta({ fileName: "s3", sessionSetupRev: "rev-b", sessionKartId: "veh-1", trackName: "Track A", courseName: "CW", fastestLapMs: 61000, sessionStartTime: 300 }),
  ];

  it("orders entries chronologically with the first as the original (no diff)", () => {
    const h = buildSetupHistory({ setupId: "setup-1", setupName: "Race Day Dry", revisions: revs, metas, vehicles: VEHICLES });
    expect(h.entries.map((e) => e.revision.id)).toEqual(["rev-a", "rev-b"]);
    expect(h.entries[0].diff).toBeNull();
    expect(h.entries[1].diff).not.toBeNull();
  });

  it("computes fastest lap per revision and flags the overall fastest", () => {
    const h = buildSetupHistory({ setupId: "setup-1", setupName: "x", revisions: revs, metas, vehicles: VEHICLES });
    expect(h.entries[0].fastestLapMs).toBe(63000);
    expect(h.entries[1].fastestLapMs).toBe(61000);
    expect(h.overallFastestLapMs).toBe(61000);
    expect(h.entries[1].isFastestOverall).toBe(true);
    expect(h.entries[0].isFastestOverall).toBe(false);
  });

  it("exposes kart and course filter options used across the setup", () => {
    const h = buildSetupHistory({ setupId: "setup-1", setupName: "x", revisions: revs, metas, vehicles: VEHICLES });
    expect(h.kartOptions.map((k) => k.name)).toEqual(["Kart #7", "Kart #9"]);
    expect(h.courseOptions.map((c) => c.label)).toContain("Track A — CW");
    expect(h.courseOptions.map((c) => c.label)).toContain("Track B — CCW");
  });

  it("filters by kart, dropping revisions with no matching session", () => {
    const h = buildSetupHistory({
      setupId: "setup-1",
      setupName: "x",
      revisions: revs,
      metas,
      vehicles: VEHICLES,
      filter: { kartId: "veh-2" },
    });
    // only rev-a was run on veh-2
    expect(h.entries.map((e) => e.revision.id)).toEqual(["rev-a"]);
    expect(h.entries[0].fastestLapMs).toBe(63000);
  });

  it("filters by course", () => {
    const courseKey = h(metas[0]);
    const built = buildSetupHistory({
      setupId: "setup-1",
      setupName: "x",
      revisions: revs,
      metas,
      vehicles: VEHICLES,
      filter: { courseKey },
    });
    expect(built.entries.map((e) => e.revision.id)).toEqual(["rev-a", "rev-b"]);
    // CW on Track A: rev-a 65000, rev-b 61000
    expect(built.entries[0].fastestLapMs).toBe(65000);
    expect(built.entries[1].fastestLapMs).toBe(61000);
  });

  it("ignores revisions for other setups", () => {
    const other = makeRevision("rev-x", 5000, makeSetup());
    other.setupId = "setup-2";
    const built = buildSetupHistory({ setupId: "setup-1", setupName: "x", revisions: [...revs, other], metas, vehicles: VEHICLES });
    expect(built.entries.find((e) => e.revision.id === "rev-x")).toBeUndefined();
  });
});

// Helper to derive the composite course key the module builds internally.
function h(meta: FileMetadata): string {
  return `${meta.trackName ?? ""}\x1f${meta.courseName}`;
}
