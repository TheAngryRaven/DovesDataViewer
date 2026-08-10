import { describe, it, expect } from "vitest";
import { planOperations, type SyncOperation, type SyncResolution } from "./deviceSyncOps";
import type { SyncTrackRow } from "./deviceSyncPlan";
import {
  buildMergedTrackList,
  deviceTrackFileFrom,
  type DeviceCourseJson,
  type DeviceTrackFileJson,
} from "./deviceTrackSync";
import type { Course, Track } from "@/types/racing";

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    name: "Full CW",
    startFinishA: { lat: 35.4, lon: -97.3 },
    startFinishB: { lat: 35.4001, lon: -97.3001 },
    isUserDefined: true,
    ...overrides,
  };
}

function makeDeviceCourse(name = "N260803_1432"): DeviceCourseJson {
  return {
    name,
    start_a_lat: 35.5,
    start_a_lng: -97.5,
    start_b_lat: 35.5001,
    start_b_lng: -97.5001,
  };
}

function row(overrides: Partial<SyncTrackRow> = {}): SyncTrackRow {
  return {
    key: "circuit:08031432",
    shortName: "08031432",
    name: "N260803_1432",
    kind: "circuit",
    direction: "download",
    needsRename: true,
    deviceFileName: "N260803_1432.json",
    deviceOnlyCourses: [makeDeviceCourse()],
    courses: [],
    ...overrides,
  };
}

function resolve(overrides: Partial<SyncResolution> = {}): SyncResolution {
  return { row: row(), name: "Sunset Park", shortName: "SUNSET", ...overrides };
}

const types = (ops: SyncOperation[]) => ops.map((o) => o.type);
const put = (ops: SyncOperation[]) =>
  ops.find((o) => o.type === "device_put") as Extract<SyncOperation, { type: "device_put" }>;
const appPut = (ops: SyncOperation[]) =>
  ops.find((o) => o.type === "app_put") as Extract<SyncOperation, { type: "app_put" }>;

// ─── Ordering ────────────────────────────────────────────────────────────────

describe("planOperations ordering", () => {
  // Put before delete: a failure between them leaves the track on the card
  // twice, which the next sync reconciles. Delete-first loses a field recording
  // to a dropped BLE packet.
  it("writes the new file before deleting the old one", () => {
    const ops = planOperations([resolve()]);
    expect(types(ops)).toEqual(["device_put", "device_delete", "app_put"]);
  });

  // Device before app: if the app write fails, the device holds a correctly
  // named file and the app holds nothing, so the next connect offers a plain
  // download. The reverse strands a renamed app track beside its old file and
  // the user sees the track twice.
  it("finishes with the device before touching local storage", () => {
    const ops = planOperations([resolve()]);
    const lastDevice = Math.max(
      ops.findIndex((o) => o.type === "device_delete"),
      ops.findIndex((o) => o.type === "device_put"),
    );
    const firstApp = ops.findIndex((o) => o.type.startsWith("app_"));
    expect(lastDevice).toBeLessThan(firstApp);
  });

  it("keeps each track's operations together", () => {
    const ops = planOperations([
      resolve(),
      resolve({
        row: row({ key: "circuit:OKC", shortName: "OKC", name: "OKC", deviceFileName: "OKC.json" }),
        name: "Orlando Kart Center",
        shortName: "OKC",
      }),
    ]);
    expect(ops.slice(0, 3).every((o) => o.trackKey === "circuit:08031432")).toBe(true);
    expect(ops.slice(3).every((o) => o.trackKey === "circuit:OKC")).toBe(true);
  });
});

// ─── Deletes ─────────────────────────────────────────────────────────────────

describe("planOperations deletes", () => {
  it("skips the delete when the filename didn't change", () => {
    const ops = planOperations([
      resolve({
        row: row({ deviceFileName: "SUNSET.json" }),
        name: "Sunset Park",
        shortName: "SUNSET",
      }),
    ]);
    expect(types(ops)).toEqual(["device_put", "app_put"]);
  });

  // The card is FAT — "OKC.json" and "okc.json" are one file, so a
  // case-only difference would delete the file just written.
  it("treats a case-only filename difference as the same file", () => {
    const ops = planOperations([
      resolve({ row: row({ deviceFileName: "sunset.json" }), shortName: "SUNSET" }),
    ]);
    expect(types(ops)).not.toContain("device_delete");
  });

  it("has nothing to delete for a track that was never on the device", () => {
    const ops = planOperations([
      resolve({
        row: row({ deviceFileName: undefined, appTrack: { name: "Sunset Park", courses: [] } }),
      }),
    ]);
    expect(types(ops)).not.toContain("device_delete");
  });

  it("drops the old local track when the name changed", () => {
    const appTrack: Track = { name: "Old Name", shortName: "OLD", courses: [makeCourse()] };
    const ops = planOperations([
      resolve({ row: row({ appTrack, deviceFileName: "OLD.json" }), name: "New Name" }),
    ]);
    const del = ops.find((o) => o.type === "app_delete");
    expect(del).toMatchObject({ type: "app_delete", trackName: "Old Name" });
  });

  it("keeps the local track when the name is unchanged", () => {
    const appTrack: Track = { name: "Sunset Park", shortName: "SUNSET", courses: [] };
    const ops = planOperations([resolve({ row: row({ appTrack }), name: "Sunset Park" })]);
    expect(types(ops)).not.toContain("app_delete");
  });
});

// ─── Course handling ─────────────────────────────────────────────────────────

describe("planOperations courses", () => {
  it("renames courses the user renamed", () => {
    const ops = planOperations([
      resolve({ courseNames: { "circuit:08031432::N260803_1432": "Morning Run" } }),
    ]);
    expect(put(ops).json).toContain("Morning Run");
    expect(appPut(ops).track.courses[0].name).toBe("Morning Run");
  });

  it("leaves courses the user didn't rename", () => {
    const ops = planOperations([resolve()]);
    expect(appPut(ops).track.courses[0].name).toBe("N260803_1432");
  });

  it("ignores a rename that is only whitespace", () => {
    const ops = planOperations([
      resolve({ courseNames: { "circuit:08031432::N260803_1432": "   " } }),
    ]);
    expect(appPut(ops).track.courses[0].name).toBe("N260803_1432");
  });

  // An upload means "the app's edits win", never "discard what was recorded in
  // the field" — that is the exact thing this flow exists to rescue.
  it("imports device-only courses alongside the app's", () => {
    const appTrack: Track = {
      name: "Sunset Park",
      shortName: "SUNSET",
      courses: [makeCourse({ name: "Existing" })],
    };
    const ops = planOperations([
      resolve({ row: row({ appTrack, deviceOnlyCourses: [makeDeviceCourse("Walked")] }) }),
    ]);
    expect(appPut(ops).track.courses.map((c) => c.name)).toEqual(["Existing", "Walked"]);
  });

  it("lets the app's copy win when a rename collides with an existing course", () => {
    const appTrack: Track = {
      name: "Sunset Park",
      shortName: "SUNSET",
      courses: [makeCourse({ name: "Full CW" })],
    };
    const ops = planOperations([
      resolve({
        row: row({ appTrack, deviceOnlyCourses: [makeDeviceCourse("Walked")] }),
        courseNames: { "circuit:08031432::Walked": "Full CW" },
      }),
    ]);
    expect(appPut(ops).track.courses.map((c) => c.name)).toEqual(["Full CW"]);
  });

  it("names the first course as the file's default", () => {
    const ops = planOperations([resolve()]);
    const file: DeviceTrackFileJson = JSON.parse(put(ops).json);
    expect(file.defaultCourse).toBe("N260803_1432");
  });
});

// ─── The written file ────────────────────────────────────────────────────────

describe("planOperations output", () => {
  it("writes to the new short name, in the track's own folder", () => {
    const ops = planOperations([resolve({ row: row({ kind: "sprint" }) })]);
    expect(put(ops).fileName).toBe("SUNSET.json");
    expect(put(ops).folder).toBe("sprint");
  });

  it("carries the chosen names into the file", () => {
    const file: DeviceTrackFileJson = JSON.parse(put(planOperations([resolve()])).json);
    expect(file.longName).toBe("Sunset Park");
    expect(file.shortName).toBe("SUNSET");
  });

  it("marks the imported track as the user's own", () => {
    expect(appPut(planOperations([resolve()])).track.isUserDefined).toBe(true);
  });
});

// ─── The property the whole flow rests on ────────────────────────────────────

describe("planOperations settles the sync", () => {
  // If this fails, the on-connect prompt re-fires on every single connect —
  // the exact failure this feature exists to avoid.
  it("leaves the device and the app agreeing, so nothing is re-offered", () => {
    const ops = planOperations([resolve()]);

    // Replay the plan: the device ends up holding the written file...
    const written = put(ops);
    const onDevice = deviceTrackFileFrom(written.fileName, written.json, written.folder);
    // ...and local storage holds the track that was stored.
    const stored = appPut(ops).track;

    const merged = buildMergedTrackList([stored], [onDevice]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("synced");
  });

  it("settles a renamed sprint track too", () => {
    const sprintCourse = makeDeviceCourse("N260803_1432");
    sprintCourse.finish_a_lat = 35.51;
    sprintCourse.finish_a_lng = -97.51;
    sprintCourse.finish_b_lat = 35.52;
    sprintCourse.finish_b_lng = -97.52;
    sprintCourse.date_created = "2026-08-03T14:32";

    const ops = planOperations([
      resolve({
        row: row({ kind: "sprint", deviceOnlyCourses: [sprintCourse] }),
        name: "Sunset Autocross",
        shortName: "SUNAX",
      }),
    ]);
    const written = put(ops);
    const onDevice = deviceTrackFileFrom(written.fileName, written.json, "sprint");
    const merged = buildMergedTrackList([appPut(ops).track], [onDevice]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("synced");
  });
});

// ─── Curation survives the sync (plan 0017) ──────────────────────────────────

describe("planOperations — device subset", () => {
  function sprintCourse(name: string, dateCreated: string): Course {
    return makeCourse({
      name,
      type: "sprint",
      dateCreated,
      finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
    });
  }

  const appTrack = (): Track => ({
    name: "Autocross Lot",
    shortName: "LOT",
    courses: [
      sprintCourse("Run Jan", "2026-01-04T09:00"),
      sprintCourse("Run Aug", "2026-08-09T14:32"),
    ],
    isUserDefined: true,
  });

  function sprintResolution(): SyncResolution {
    return resolve({
      row: row({
        kind: "sprint",
        key: "sprint:LOT",
        shortName: "LOT",
        name: "Autocross Lot",
        needsRename: false,
        deviceFileName: "LOT.json",
        deviceOnlyCourses: [],
        appTrack: appTrack(),
      }),
      name: "Autocross Lot",
      shortName: "LOT",
    });
  }

  // The failure this closes: accepting the wizard re-uploaded every course and
  // silently undid the curation, putting the file straight back over the
  // firmware's parse buffer.
  it("writes only the newest sprint course to the device", () => {
    const ops = planOperations([sprintResolution()]);
    const written: DeviceTrackFileJson = JSON.parse(put(ops).json);
    expect(written.courses.map((c) => c.name)).toEqual(["Run Aug"]);
  });

  // ...while the app keeps everything. Nothing is lost; only the card holds a
  // subset. These are deliberately two different lists.
  it("keeps every course in the app", () => {
    const ops = planOperations([sprintResolution()]);
    expect(appPut(ops).track.courses.map((c) => c.name)).toEqual(["Run Jan", "Run Aug"]);
  });

  it("names a default course the device actually has", () => {
    const ops = planOperations([sprintResolution()]);
    const written: DeviceTrackFileJson = JSON.parse(put(ops).json);
    expect(written.defaultCourse).toBe("Run Aug");
  });

  it("honours an explicit include, writing the older course too", () => {
    const ops = planOperations([sprintResolution()], () => ({
      include: ["Run Jan"],
      exclude: [],
    }));
    const written: DeviceTrackFileJson = JSON.parse(put(ops).json);
    expect(written.courses.map((c) => c.name)).toEqual(["Run Jan", "Run Aug"]);
  });

  it("leaves circuit tracks carrying every course", () => {
    const circuit: Track = {
      name: "Orlando Kart Center",
      shortName: "OKC",
      courses: [makeCourse({ name: "CW" }), makeCourse({ name: "CCW" })],
      isUserDefined: true,
    };
    const ops = planOperations([
      resolve({
        row: row({
          kind: "circuit",
          key: "circuit:OKC",
          shortName: "OKC",
          name: "Orlando Kart Center",
          needsRename: false,
          deviceFileName: "OKC.json",
          deviceOnlyCourses: [],
          appTrack: circuit,
        }),
        name: "Orlando Kart Center",
        shortName: "OKC",
      }),
    ]);
    const written: DeviceTrackFileJson = JSON.parse(put(ops).json);
    expect(written.courses.map((c) => c.name)).toEqual(["CW", "CCW"]);
  });

  // The property that has to hold end to end: write the subset, read it back,
  // and the merge must say `synced` rather than re-offering the work.
  it("round-trips to 'synced' with the subset on the card", () => {
    const ops = planOperations([sprintResolution()]);
    const written = put(ops);
    const onDevice = deviceTrackFileFrom(written.fileName, written.json, "sprint");
    const merged = buildMergedTrackList([appPut(ops).track], [onDevice]);
    expect(merged[0].status).toBe("synced");
  });
});
