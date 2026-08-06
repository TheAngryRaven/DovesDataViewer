import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchDeviceTrackFiles, buildDeviceSyncSnapshot } from "./deviceSyncFetch";
import type { DeviceDetails } from "@/lib/loggers";
import type { Track } from "@/types/racing";

const COURSE = {
  name: "Full CW",
  lengthFt: 1500,
  start_a_lat: 35.4,
  start_a_lng: -97.3,
  start_b_lat: 35.4001,
  start_b_lng: -97.3001,
};

function trackFileJson(longName: string, shortName: string, type = "circuit") {
  return JSON.stringify({ longName, shortName, type, defaultCourse: COURSE.name, courses: [COURSE] });
}

function details(overrides: Partial<DeviceDetails> = {}): DeviceDetails {
  return {
    battery: vi.fn(),
    listSettings: vi.fn(),
    setSetting: vi.fn(),
    resetSettings: vi.fn(),
    listTracks: vi.fn(async () => []),
    getTrack: vi.fn(async () => new Uint8Array()),
    putTrack: vi.fn(async () => {}),
    deleteTrack: vi.fn(async () => {}),
    supportsSprintTracks: true,
    ...overrides,
  } as unknown as DeviceDetails;
}

afterEach(() => vi.restoreAllMocks());

describe("fetchDeviceTrackFiles", () => {
  it("reads both folders and tags each file with its kind", async () => {
    const d = details({
      listTracks: vi.fn(async (kind?: string) =>
        kind === "sprint" ? ["SPR.json"] : ["OKC.json"],
      ),
      getTrack: vi.fn(async (name: string) =>
        new TextEncoder().encode(
          name === "SPR.json" ? trackFileJson("Sprint Venue", "SPR", "sprint") : trackFileJson("Orlando", "OKC"),
        ),
      ),
    });

    const files = await fetchDeviceTrackFiles(d);
    expect(files.map((f) => [f.shortName, f.kind])).toEqual([
      ["OKC", "circuit"],
      ["SPR", "sprint"],
    ]);
    expect(files[0].fileName).toBe("OKC.json");
    expect(files[0].longName).toBe("Orlando");
  });

  // A missing capability must not read as an empty folder.
  it("skips the sprint folder when the transport can't reach it", async () => {
    const listTracks = vi.fn(async () => ["OKC.json"]);
    const d = details({
      listTracks,
      supportsSprintTracks: false,
      getTrack: vi.fn(async () => new TextEncoder().encode(trackFileJson("Orlando", "OKC"))),
    });

    const files = await fetchDeviceTrackFiles(d);
    expect(files).toHaveLength(1);
    expect(listTracks).toHaveBeenCalledTimes(1);
    expect(listTracks).toHaveBeenCalledWith("circuit");
  });

  it("keeps the circuit list when the sprint listing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = details({
      listTracks: vi.fn(async (kind?: string) => {
        if (kind === "sprint") throw new Error("TERR:BUSY");
        return ["OKC.json"];
      }),
      getTrack: vi.fn(async () => new TextEncoder().encode(trackFileJson("Orlando", "OKC"))),
    });
    await expect(fetchDeviceTrackFiles(d)).resolves.toHaveLength(1);
  });

  it("skips one unreadable file rather than losing the listing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = details({
      supportsSprintTracks: false,
      listTracks: vi.fn(async () => ["BAD.json", "OKC.json"]),
      getTrack: vi.fn(async (name: string) => {
        if (name === "BAD.json") throw new Error("TERR:NO_FILE");
        return new TextEncoder().encode(trackFileJson("Orlando", "OKC"));
      }),
    });
    const files = await fetchDeviceTrackFiles(d);
    expect(files.map((f) => f.shortName)).toEqual(["OKC"]);
  });

  it("reports progress per file", async () => {
    const d = details({
      supportsSprintTracks: false,
      listTracks: vi.fn(async () => ["A.json", "B.json"]),
      getTrack: vi.fn(async () => new TextEncoder().encode("[]")),
    });
    const seen: string[] = [];
    await fetchDeviceTrackFiles(d, (p) => seen.push(`${p.current}/${p.total} ${p.label}`));
    expect(seen).toEqual(["1/2 A.json", "2/2 B.json"]);
  });
});

describe("buildDeviceSyncSnapshot", () => {
  const appTrack: Track = {
    name: "Orlando",
    shortName: "OKC",
    courses: [
      {
        name: "Full CW",
        lengthFt: 1500,
        startFinishA: { lat: 35.4, lon: -97.3 },
        startFinishB: { lat: 35.4001, lon: -97.3001 },
        isUserDefined: true,
      },
    ],
    isUserDefined: true,
  };

  it("offers nothing when both sides already agree", async () => {
    const d = details({
      supportsSprintTracks: false,
      listTracks: vi.fn(async () => ["OKC.json"]),
      getTrack: vi.fn(async () => new TextEncoder().encode(trackFileJson("Orlando", "OKC"))),
    });
    const snapshot = await buildDeviceSyncSnapshot(d, [appTrack]);
    expect(snapshot.plan.rows).toEqual([]);
  });

  // A rename must not be allowed to land on an already-synced track's file.
  it("reserves the short names of tracks the plan isn't touching", async () => {
    const d = details({
      supportsSprintTracks: false,
      listTracks: vi.fn(async () => ["OKC.json", "N260803_1432.json"]),
      getTrack: vi.fn(async (name: string) =>
        new TextEncoder().encode(
          name === "OKC.json"
            ? trackFileJson("Orlando", "OKC")
            : trackFileJson("N260803_1432", "08031432"),
        ),
      ),
    });
    const snapshot = await buildDeviceSyncSnapshot(d, [appTrack]);
    expect(snapshot.plan.rows.map((r) => r.shortName)).toEqual(["08031432"]);
    expect(snapshot.reserved).toEqual([{ kind: "circuit", shortName: "OKC" }]);
  });

  it("passes the sprint capability through to the plan", async () => {
    const d = details({
      supportsSprintTracks: false,
      listTracks: vi.fn(async () => []),
      getTrack: vi.fn(async () => new Uint8Array()),
    });
    // An app-side sprint track can't be pushed on a transport that can't reach
    // the sprint folder — the write would land among the circuit tracks.
    const sprintTrack: Track = {
      name: "Sprint Venue",
      shortName: "SPR",
      isUserDefined: true,
      courses: [
        {
          name: "Run",
          type: "sprint",
          startFinishA: { lat: 35.4, lon: -97.3 },
          startFinishB: { lat: 35.4001, lon: -97.3001 },
          finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
          isUserDefined: true,
        },
      ],
    };
    const snapshot = await buildDeviceSyncSnapshot(d, [sprintTrack]);
    expect(snapshot.plan.rows).toEqual([]);
    expect(snapshot.plan.skipped[0].reason).toBe("sprint_unsupported");
  });
});
