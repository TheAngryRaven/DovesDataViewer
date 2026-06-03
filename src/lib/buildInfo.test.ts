import { describe, it, expect } from "vitest";
import { hasCommit, formatBuildLabel, commitUrl, type BuildInfo } from "./buildInfo";

const withCommit: BuildInfo = { version: "2.0.0", commit: "837b514", buildDate: "2026-06-03T00:00:00.000Z" };
const noCommit: BuildInfo = { version: "2.0.0", commit: "unknown", buildDate: "" };
const emptyCommit: BuildInfo = { version: "1.5.0", commit: "", buildDate: "" };

describe("buildInfo helpers", () => {
  describe("hasCommit", () => {
    it("is true for a real hash", () => {
      expect(hasCommit(withCommit)).toBe(true);
    });
    it("is false for 'unknown' or empty", () => {
      expect(hasCommit(noCommit)).toBe(false);
      expect(hasCommit(emptyCommit)).toBe(false);
    });
  });

  describe("formatBuildLabel", () => {
    it("includes the hash when present", () => {
      expect(formatBuildLabel(withCommit)).toBe("v2.0.0 · 837b514");
    });
    it("omits the hash when unknown", () => {
      expect(formatBuildLabel(noCommit)).toBe("v2.0.0");
      expect(formatBuildLabel(emptyCommit)).toBe("v1.5.0");
    });
  });

  describe("commitUrl", () => {
    it("builds a GitHub commit URL for a real hash", () => {
      expect(commitUrl(withCommit)).toBe(
        "https://github.com/TheAngryRaven/DovesDataViewer/commit/837b514",
      );
    });
    it("returns null without a real hash", () => {
      expect(commitUrl(noCommit)).toBeNull();
      expect(commitUrl(emptyCommit)).toBeNull();
    });
  });
});
