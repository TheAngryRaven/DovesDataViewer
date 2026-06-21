import { describe, it, expect } from "vitest";
import { isUpdateAvailable, type RemoteVersion } from "@/lib/versionCheck";
import type { BuildInfo } from "@/lib/buildInfo";

const local: BuildInfo = {
  version: "2.8.1",
  commit: "aaaaaaa",
  buildDate: "2026-06-20T12:00:00.000Z",
  branch: "main",
  commitDate: "2026-06-20T11:59:00.000Z",
};

const remote = (over: Partial<RemoteVersion>): RemoteVersion => ({
  version: "2.8.1",
  commit: "bbbbbbb",
  buildDate: "2026-06-21T12:00:00.000Z",
  branch: "main",
  commitDate: "2026-06-21T11:59:00.000Z",
  ...over,
});

describe("isUpdateAvailable", () => {
  it("true when remote has a different commit and a newer build date", () => {
    expect(isUpdateAvailable(remote({}), local)).toBe(true);
  });

  it("false when commits match (same build)", () => {
    expect(isUpdateAvailable(remote({ commit: local.commit }), local)).toBe(false);
  });

  it("false when remote build date is older (rollback / local ahead)", () => {
    expect(
      isUpdateAvailable(remote({ buildDate: "2026-06-19T12:00:00.000Z" }), local),
    ).toBe(false);
  });

  it("false when remote build date equals local build date", () => {
    expect(isUpdateAvailable(remote({ buildDate: local.buildDate }), local)).toBe(false);
  });

  it("false when either commit is 'unknown'", () => {
    expect(isUpdateAvailable(remote({ commit: "unknown" }), local)).toBe(false);
    expect(isUpdateAvailable(remote({}), { ...local, commit: "unknown" })).toBe(false);
  });

  it("false when build dates are missing", () => {
    expect(isUpdateAvailable(remote({ buildDate: "" }), local)).toBe(false);
    expect(isUpdateAvailable(remote({}), { ...local, buildDate: "" })).toBe(false);
  });

  it("false for null / undefined remote (offline or fetch failure)", () => {
    expect(isUpdateAvailable(null, local)).toBe(false);
    expect(isUpdateAvailable(undefined, local)).toBe(false);
  });
});
