import { describe, it, expect } from "vitest";
import {
  hasCommit,
  isPreviewBuild,
  formatCommitTime,
  formatBuildLabel,
  commitUrl,
  type BuildInfo,
} from "./buildInfo";

const mainBuild: BuildInfo = {
  version: "2.0.0",
  commit: "837b514",
  buildDate: "2026-06-03T00:00:00.000Z",
  branch: "main",
  commitDate: "2026-06-02T23:28:13-04:00",
};
const branchBuild: BuildInfo = {
  ...mainBuild,
  branch: "claude/footer-branch-preview-stamp",
};
const noCommit: BuildInfo = {
  version: "2.0.0",
  commit: "unknown",
  buildDate: "",
  branch: "unknown",
  commitDate: "",
};
const emptyCommit: BuildInfo = { ...noCommit, version: "1.5.0", commit: "" };

describe("buildInfo helpers", () => {
  describe("hasCommit", () => {
    it("is true for a real hash", () => {
      expect(hasCommit(mainBuild)).toBe(true);
    });
    it("is false for 'unknown' or empty", () => {
      expect(hasCommit(noCommit)).toBe(false);
      expect(hasCommit(emptyCommit)).toBe(false);
    });
  });

  describe("isPreviewBuild", () => {
    it("is false on main", () => {
      expect(isPreviewBuild(mainBuild)).toBe(false);
    });
    it("is false for an unknown branch (falls back to prod stamp)", () => {
      expect(isPreviewBuild(noCommit)).toBe(false);
    });
    it("is true on any other known branch", () => {
      expect(isPreviewBuild(branchBuild)).toBe(true);
    });
  });

  describe("formatCommitTime", () => {
    it("formats an ISO timestamp in UTC", () => {
      // 23:28:13 -04:00 → 03:28 UTC the next day
      expect(formatCommitTime("2026-06-02T23:28:13-04:00")).toBe("Jun 3, 2026, 3:28 AM UTC");
    });
    it("returns '' for empty or unparseable input", () => {
      expect(formatCommitTime("")).toBe("");
      expect(formatCommitTime("not-a-date")).toBe("");
    });
  });

  describe("formatBuildLabel", () => {
    it("shows version + hash on main", () => {
      expect(formatBuildLabel(mainBuild)).toBe("v2.0.0 · 837b514");
    });
    it("omits the hash when unknown on main", () => {
      expect(formatBuildLabel(noCommit)).toBe("v2.0.0");
      expect(formatBuildLabel(emptyCommit)).toBe("v1.5.0");
    });
    it("shows branch + hash + commit time on a non-main branch", () => {
      expect(formatBuildLabel(branchBuild)).toBe(
        "claude/footer-branch-preview-stamp · 837b514 · Jun 3, 2026, 3:28 AM UTC",
      );
    });
    it("drops missing parts on a branch build", () => {
      expect(formatBuildLabel({ ...branchBuild, commit: "unknown", commitDate: "" })).toBe(
        "claude/footer-branch-preview-stamp",
      );
    });
  });

  describe("commitUrl", () => {
    it("builds a GitHub commit URL for a real hash", () => {
      expect(commitUrl(mainBuild)).toBe(
        "https://github.com/TheAngryRaven/DovesDataViewer/commit/837b514",
      );
    });
    it("returns null without a real hash", () => {
      expect(commitUrl(noCommit)).toBeNull();
      expect(commitUrl(emptyCommit)).toBeNull();
    });
  });
});
