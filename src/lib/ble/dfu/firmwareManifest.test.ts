import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseFirmwareManifest,
  pickBuildForVariant,
  compareVersions,
  compareReleases,
  isUpdateAvailable,
  evaluateFirmwareUpdate,
  forceKindFor,
  assertImageMatchesBuild,
  getManifestUrl,
  DEFAULT_MANIFEST_URL,
  BETA_MANIFEST_URL,
  fetchFirmwareManifest,
  fetchFirmwarePackage,
} from "./firmwareManifest";
import type { FirmwareBuild } from "./dfuTypes";

describe("getManifestUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the production manifest on non-preview (main) builds", () => {
    expect(getManifestUrl(false)).toBe(DEFAULT_MANIFEST_URL);
  });

  it("uses the beta-channel manifest on preview / non-main builds", () => {
    expect(getManifestUrl(true)).toBe(BETA_MANIFEST_URL);
  });

  it("lets an explicit env override win over the beta channel", () => {
    vi.stubEnv("VITE_FIRMWARE_MANIFEST_URL", "https://custom/manifest.json");
    expect(getManifestUrl(true)).toBe("https://custom/manifest.json");
    expect(getManifestUrl(false)).toBe("https://custom/manifest.json");
  });
});

// A trimmed copy of the real published manifest shape (with the appBin fields).
const SAMPLE = {
  version: "2.2.0",
  releaseTag: "v2.2.0",
  publishedAt: "2026-06-08T04:02:55Z",
  releaseNotes: "https://example/notes",
  builds: {
    "BirdsEye-sense": {
      variant: "sense",
      dfuZip: "https://example/firmware/2.2.0/BirdsEye-sense.zip",
      appBin: "https://example/firmware/2.2.0/BirdsEye-sense.bin",
      appCrc32: "7e27fc48",
      appSize: 287900,
    },
    "BirdsEye-nonsense": {
      variant: "nonsense",
      dfuZip: "https://example/firmware/2.2.0/BirdsEye-nonsense.zip",
      appBin: "https://example/firmware/2.2.0/BirdsEye-nonsense.bin",
      appCrc32: "53ebc1cd",
      appSize: 287884,
    },
  },
};

describe("parseFirmwareManifest", () => {
  it("parses a well-formed manifest", () => {
    const m = parseFirmwareManifest(SAMPLE);
    expect(m.version).toBe("2.2.0");
    expect(m.releaseTag).toBe("v2.2.0");
    expect(Object.keys(m.builds)).toEqual(["BirdsEye-sense", "BirdsEye-nonsense"]);
    expect(m.builds["BirdsEye-sense"]).toEqual({
      name: "BirdsEye-sense",
      variant: "sense",
      dfuZip: "https://example/firmware/2.2.0/BirdsEye-sense.zip",
      appBin: "https://example/firmware/2.2.0/BirdsEye-sense.bin",
      appCrc32: "7e27fc48",
      appSize: 287900,
    });
  });

  it("leaves appBin/appCrc32/appSize undefined when absent (older manifests)", () => {
    const m = parseFirmwareManifest({
      version: "1.0.0",
      builds: { "BirdsEye-sense": { variant: "sense", dfuZip: "z" } },
    });
    const b = m.builds["BirdsEye-sense"];
    expect(b.appBin).toBeUndefined();
    expect(b.appCrc32).toBeUndefined();
    expect(b.appSize).toBeUndefined();
  });

  it("normalizes appCrc32 to lowercase", () => {
    const m = parseFirmwareManifest({
      version: "1.0.0",
      builds: { s: { variant: "sense", dfuZip: "z", appCrc32: "7E27FC48" } },
    });
    expect(m.builds.s.appCrc32).toBe("7e27fc48");
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

  // This is the CAPABILITY comparator, and the prerelease-blindness above is
  // load-bearing, not incidental: `supportsLargeTrackBuffer` and
  // `needsOtaLayoutUpgrade` both ask "does this build carry feature X", and a
  // beta cut from a release carries that release's features. If someone
  // "fixes" this to be semver-strict, a 3.2.0-beta device silently loses the
  // large track buffer and a 3.1.0-beta device is told to hop through 3.1.0.
  // Release ordering is `compareReleases`, tested separately below.
  it("treats a beta as its own release — the capability gate depends on it", () => {
    expect(compareVersions("3.2.0-beta.a1b2c3d", "3.2.0")).toBe(0);
    expect(compareVersions("3.1.0-beta.deadbee", "3.1.0")).toBe(0);
  });
});

describe("compareReleases", () => {
  it("orders the numeric core exactly like compareVersions", () => {
    expect(compareReleases("2.1.0", "2.0.0")).toBe(1);
    expect(compareReleases("2.0.0", "2.1.0")).toBe(-1);
    expect(compareReleases("2.1.0", "2.1.0")).toBe(0);
    expect(compareReleases("2.10.0", "2.9.0")).toBe(1);
    expect(compareReleases("1.0.0", "1.0")).toBe(0);
    expect(compareReleases("v2.1.0", "2.1.0")).toBe(0);
  });

  // The bug this function exists for: a logger on 4.1.0-beta.<sha> could not
  // be moved to the official 4.1.0.
  it("ranks an official release above the beta it was cut from", () => {
    expect(compareReleases("4.1.0", "4.1.0-beta.a1b2c3d")).toBe(1);
    expect(compareReleases("4.1.0-beta.a1b2c3d", "4.1.0")).toBe(-1);
  });

  it("ignores build metadata entirely (semver §10)", () => {
    expect(compareReleases("4.1.0+ci7", "4.1.0")).toBe(0);
    expect(compareReleases("4.1.0-beta.1+ci7", "4.1.0-beta.1")).toBe(0);
    expect(compareReleases("4.2.0+ci7", "4.1.0")).toBe(1);
  });

  // The precedence chain straight out of semver 2.0.0 §11.
  it.each([
    ["1.0.0-alpha", "1.0.0-alpha.1"],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta"],
    ["1.0.0-alpha.beta", "1.0.0-beta"],
    ["1.0.0-beta", "1.0.0-beta.2"],
    ["1.0.0-beta.2", "1.0.0-beta.11"], // numeric identifiers compare numerically
    ["1.0.0-beta.11", "1.0.0-rc.1"],
    ["1.0.0-rc.1", "1.0.0"],
  ] as const)("%s < %s", (lower, higher) => {
    expect(compareReleases(lower, higher)).toBe(-1);
    expect(compareReleases(higher, lower)).toBe(1);
  });

  it("ranks a numeric identifier below an alphanumeric one", () => {
    expect(compareReleases("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });

  it("is a total order over a realistic release sequence", () => {
    const ordered = [
      "4.0.1",
      "4.1.0-beta.0000001",
      "4.1.0-beta.zzzzzzz",
      "4.1.0",
      "4.1.1-beta.abc1234",
      "4.1.1",
      "4.2.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareReleases(ordered[i], ordered[i + 1])).toBe(-1);
      expect(compareReleases(ordered[i + 1], ordered[i])).toBe(1);
      expect(compareReleases(ordered[i], ordered[i])).toBe(0);
    }
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

  // The reported failure: a beta tester on 4.1.0-beta.<sha> was told they were
  // up to date when the official 4.1.0 shipped.
  it("offers the official release to a device on that release's beta", () => {
    expect(isUpdateAvailable("4.1.0-beta.a1b2c3d", "4.1.0")).toBe(true);
  });

  it("does not offer an older release to a device on a newer beta", () => {
    // Still false — this is what the user-initiated force path is for.
    expect(isUpdateAvailable("4.2.0-beta.a1b2c3d", "4.1.0")).toBe(false);
  });

  it("does not re-offer a release to a device already on it", () => {
    expect(isUpdateAvailable("4.1.0", "4.1.0")).toBe(false);
    expect(isUpdateAvailable("4.1.0+ci7", "4.1.0")).toBe(false);
  });
});

describe("forceKindFor", () => {
  it("is null when nothing was bypassed", () => {
    expect(forceKindFor("update", false, "4.0.0")).toBeNull();
    expect(forceKindFor("up-to-date", false, "4.1.0")).toBeNull();
    // Even a user asking doesn't make a normal offer a bypass.
    expect(forceKindFor("update", true, "4.0.0")).toBeNull();
  });

  it("separates a preview-build bypass from a user-requested one", () => {
    expect(forceKindFor("forced", false, "4.1.0-beta.a1b2c3d")).toBe("preview");
    expect(forceKindFor("forced", true, "4.1.0-beta.a1b2c3d")).toBe("user");
  });

  // `force` resolves before `no-version` inside evaluateFirmwareUpdate, so the
  // reason alone can't tell these apart — the more informative one wins.
  it("prefers 'unknown' over 'user' when there was no version to compare", () => {
    expect(forceKindFor("forced", true, null)).toBe("unknown");
    expect(forceKindFor("forced", false, null)).toBe("unknown");
    expect(forceKindFor("forced", true, undefined)).toBe("unknown");
    expect(forceKindFor("forced", true, "")).toBe("unknown");
  });
});

describe("evaluateFirmwareUpdate", () => {
  const m = parseFirmwareManifest(SAMPLE); // latest 2.2.0

  it("offers an update when a newer build exists for the variant", () => {
    const e = evaluateFirmwareUpdate({ version: "2.0.0", variant: "sense" }, m);
    expect(e).toMatchObject({ available: true, reason: "update", latestVersion: "2.2.0" });
    expect(e.build?.name).toBe("BirdsEye-sense");
  });

  it("reports up-to-date when the installed version is current", () => {
    const e = evaluateFirmwareUpdate({ version: "2.2.0", variant: "nonsense" }, m);
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
      const e = evaluateFirmwareUpdate({ version: "2.2.0", variant: "sense" }, m, {
        force: true,
      });
      expect(e).toMatchObject({ available: true, reason: "forced", latestVersion: "2.2.0" });
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

describe("assertImageMatchesBuild (download-integrity check)", () => {
  const build: FirmwareBuild = {
    name: "BirdsEye-sense",
    variant: "sense",
    dfuZip: "z",
    appBin: "b",
    appCrc32: "7e27fc48",
    appSize: 4,
  };
  const image = new Uint8Array([1, 2, 3, 4]);

  it("passes when size + CRC match the manifest", () => {
    expect(() => assertImageMatchesBuild(build, image, "7e27fc48")).not.toThrow();
  });

  it("accepts a differently-cased CRC from the manifest", () => {
    expect(() =>
      assertImageMatchesBuild({ ...build, appCrc32: "7E27FC48" }, image, "7e27fc48"),
    ).not.toThrow();
  });

  it("throws on a size mismatch", () => {
    expect(() => assertImageMatchesBuild({ ...build, appSize: 99 }, image, "7e27fc48")).toThrow(
      /bytes but the manifest expects 99/,
    );
  });

  it("throws on a CRC mismatch (corrupt download)", () => {
    expect(() => assertImageMatchesBuild(build, image, "deadbeef")).toThrow(/corrupt download/);
  });

  it("is a no-op when the manifest omits size + CRC (older manifests)", () => {
    const bare: FirmwareBuild = { name: "x", variant: "sense", dfuZip: "z" };
    expect(() => assertImageMatchesBuild(bare, image, "anything")).not.toThrow();
  });
});

describe("fetchFirmwareManifest", () => {
  it("fetches + parses via an injected fetch", async () => {
    const fetchImpl = async () =>
      ({ ok: true, status: 200, json: async () => SAMPLE }) as unknown as Response;
    const m = await fetchFirmwareManifest("https://example/manifest.json", fetchImpl);
    expect(m.version).toBe("2.2.0");
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
