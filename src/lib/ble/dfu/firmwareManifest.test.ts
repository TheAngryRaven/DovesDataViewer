import { describe, it, expect } from "vitest";
import {
  parseFirmwareManifest,
  pickBuildForVariant,
  compareVersions,
  isUpdateAvailable,
  evaluateFirmwareUpdate,
  fetchFirmwareManifest,
  fetchFirmwarePackage,
} from "./firmwareManifest";

// A trimmed copy of the real published manifest shape.
const SAMPLE = {
  version: "2.1.0",
  releaseTag: "v2.1.0",
  publishedAt: "2026-06-06T06:10:26Z",
  releaseNotes: "https://example/notes",
  builds: {
    "BirdsEye-sense": {
      variant: "sense",
      dfuZip: "https://example/firmware/2.1.0/BirdsEye-sense.zip",
    },
    "BirdsEye-nonsense": {
      variant: "nonsense",
      dfuZip: "https://example/firmware/2.1.0/BirdsEye-nonsense.zip",
    },
  },
};

describe("parseFirmwareManifest", () => {
  it("parses a well-formed manifest", () => {
    const m = parseFirmwareManifest(SAMPLE);
    expect(m.version).toBe("2.1.0");
    expect(m.releaseTag).toBe("v2.1.0");
    expect(Object.keys(m.builds)).toEqual(["BirdsEye-sense", "BirdsEye-nonsense"]);
    expect(m.builds["BirdsEye-sense"]).toEqual({
      name: "BirdsEye-sense",
      variant: "sense",
      dfuZip: "https://example/firmware/2.1.0/BirdsEye-sense.zip",
    });
  });

  it("defaults a build's variant to its key when absent", () => {
    const m = parseFirmwareManifest({
      version: "1.0.0",
      builds: { "BirdsEye-sense": { dfuZip: "z" } },
    });
    expect(m.builds["BirdsEye-sense"].variant).toBe("BirdsEye-sense");
  });

  it("skips malformed build entries but keeps usable ones", () => {
    const m = parseFirmwareManifest({
      version: "1.0.0",
      builds: {
        good: { variant: "sense", dfuZip: "z" },
        bad: { variant: "x" }, // no dfuZip
      },
    });
    expect(Object.keys(m.builds)).toEqual(["good"]);
  });

  it.each([
    ["not an object", 42],
    ["missing version", { builds: {} }],
    ["missing builds", { version: "1.0.0" }],
    ["no usable builds", { version: "1.0.0", builds: { x: {} } }],
  ])("throws on %s", (_label, input) => {
    expect(() => parseFirmwareManifest(input)).toThrow();
  });
});

describe("pickBuildForVariant", () => {
  const m = parseFirmwareManifest(SAMPLE);

  it("matches by variant", () => {
    expect(pickBuildForVariant(m, "sense")?.name).toBe("BirdsEye-sense");
    expect(pickBuildForVariant(m, "nonsense")?.name).toBe("BirdsEye-nonsense");
  });

  it("is case-insensitive and trims", () => {
    expect(pickBuildForVariant(m, "  SENSE ")?.name).toBe("BirdsEye-sense");
  });

  it("falls back to matching the full model name", () => {
    expect(pickBuildForVariant(m, "BirdsEye-sense")?.name).toBe("BirdsEye-sense");
  });

  it("returns null for unknown or empty variant", () => {
    expect(pickBuildForVariant(m, "turbo")).toBeNull();
    expect(pickBuildForVariant(m, null)).toBeNull();
    expect(pickBuildForVariant(m, "")).toBeNull();
  });
});

describe("compareVersions", () => {
  it.each([
    ["2.1.0", "2.0.0", 1],
    ["2.0.0", "2.1.0", -1],
    ["2.1.0", "2.1.0", 0],
    ["2.10.0", "2.9.0", 1], // numeric, not lexical
    ["1.0.0", "1.0", 0], // missing parts treated as 0
  ] as const)("compareVersions(%s, %s) === %i", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it("tolerates a leading 'v' and prerelease/build suffixes", () => {
    expect(compareVersions("v2.1.0", "2.1.0")).toBe(0);
    expect(compareVersions("2.1.0-beta.1", "2.1.0")).toBe(0);
    expect(compareVersions("2.2.0+build", "2.1.0")).toBe(1);
  });
});

describe("isUpdateAvailable", () => {
  it("true when latest is strictly newer", () => {
    expect(isUpdateAvailable("2.0.0", "2.1.0")).toBe(true);
  });
  it("false when up to date or ahead", () => {
    expect(isUpdateAvailable("2.1.0", "2.1.0")).toBe(false);
    expect(isUpdateAvailable("2.2.0", "2.1.0")).toBe(false);
  });
  it("false when installed version is unknown", () => {
    expect(isUpdateAvailable(null, "2.1.0")).toBe(false);
    expect(isUpdateAvailable(undefined, "2.1.0")).toBe(false);
  });
});

describe("evaluateFirmwareUpdate", () => {
  const m = parseFirmwareManifest(SAMPLE); // latest 2.1.0

  it("offers an update when a newer build exists for the variant", () => {
    const e = evaluateFirmwareUpdate({ version: "2.0.0", variant: "sense" }, m);
    expect(e).toMatchObject({ available: true, reason: "update", latestVersion: "2.1.0" });
    expect(e.build?.name).toBe("BirdsEye-sense");
  });

  it("reports up-to-date when the installed version is current", () => {
    const e = evaluateFirmwareUpdate({ version: "2.1.0", variant: "nonsense" }, m);
    expect(e.available).toBe(false);
    expect(e.reason).toBe("up-to-date");
    expect(e.build?.name).toBe("BirdsEye-nonsense");
  });

  it("flags a missing version (can't compare)", () => {
    const e = evaluateFirmwareUpdate({ version: null, variant: "sense" }, m);
    expect(e).toMatchObject({ available: false, reason: "no-version", installedVersion: null });
  });

  it("flags when no build matches the device variant", () => {
    const e = evaluateFirmwareUpdate({ version: "2.0.0", variant: "turbo" }, m);
    expect(e).toMatchObject({ available: false, reason: "no-build", build: null });
  });

  describe("force (beta/preview builds)", () => {
    it("always offers an update, even when up to date", () => {
      const e = evaluateFirmwareUpdate({ version: "2.1.0", variant: "sense" }, m, {
        force: true,
      });
      expect(e).toMatchObject({ available: true, reason: "forced", latestVersion: "2.1.0" });
      expect(e.build?.name).toBe("BirdsEye-sense");
    });

    it("offers an update even when the installed version is older or unknown", () => {
      expect(
        evaluateFirmwareUpdate({ version: "1.0.0", variant: "sense" }, m, { force: true }),
      ).toMatchObject({ available: true, reason: "forced" });
      expect(
        evaluateFirmwareUpdate({ version: null, variant: "sense" }, m, { force: true }),
      ).toMatchObject({ available: true, reason: "forced" });
    });

    it("still requires a build matching the variant", () => {
      const e = evaluateFirmwareUpdate({ version: "2.0.0", variant: "turbo" }, m, {
        force: true,
      });
      expect(e).toMatchObject({ available: false, reason: "no-build" });
    });
  });
});

describe("fetchFirmwareManifest", () => {
  it("fetches + parses via an injected fetch", async () => {
    const fetchImpl = async () =>
      ({ ok: true, status: 200, json: async () => SAMPLE }) as unknown as Response;
    const m = await fetchFirmwareManifest("https://example/manifest.json", fetchImpl);
    expect(m.version).toBe("2.1.0");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = async () =>
      ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response;
    await expect(
      fetchFirmwareManifest("https://example/manifest.json", fetchImpl),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("fetchFirmwarePackage", () => {
  it("returns the raw bytes via an injected fetch", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchImpl = async () =>
      ({ ok: true, status: 200, arrayBuffer: async () => bytes }) as unknown as Response;
    const out = await fetchFirmwarePackage("https://example/x.zip", fetchImpl);
    expect(new Uint8Array(out)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = async () =>
      ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;
    await expect(
      fetchFirmwarePackage("https://example/x.zip", fetchImpl),
    ).rejects.toThrow(/HTTP 500/);
  });
});
