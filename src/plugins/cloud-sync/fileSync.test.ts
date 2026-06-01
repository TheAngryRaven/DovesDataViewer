import { describe, it, expect } from "vitest";
import { fileSyncStatus, cloudOnlyNames, orphanedObjectNames } from "./fileSync";

describe("fileSyncStatus", () => {
  it("is 'off' when there is no record (not selected)", () => {
    expect(fileSyncStatus(undefined)).toBe("off");
  });

  it("is 'pending' when selected but not yet uploaded", () => {
    expect(fileSyncStatus({})).toBe("pending");
  });

  it("is 'synced' once a push timestamp is recorded", () => {
    expect(fileSyncStatus({ pushedAt: Date.now() })).toBe("synced");
  });
});

describe("cloudOnlyNames", () => {
  it("returns cloud files not present locally", () => {
    expect(cloudOnlyNames(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("returns nothing when every cloud file is already local", () => {
    expect(cloudOnlyNames(["a", "b"], ["a", "b", "x"])).toEqual([]);
  });
});

describe("orphanedObjectNames", () => {
  it("flags bucket objects with no matching index row", () => {
    expect(orphanedObjectNames(["run1.dovex", "ghost.dovex"], ["run1.dovex"])).toEqual([
      "ghost.dovex",
    ]);
  });

  it("decodes URL-encoded object names before comparing to raw index keys", () => {
    // Bucket path segments are encodeURIComponent(name); index keys are raw.
    expect(orphanedObjectNames(["my%20run.dovex"], ["my run.dovex"])).toEqual([]);
    expect(orphanedObjectNames(["my%20run.dovex"], ["other.dovex"])).toEqual(["my%20run.dovex"]);
  });

  it("returns nothing when every object is indexed", () => {
    expect(orphanedObjectNames(["a", "b"], ["a", "b"])).toEqual([]);
  });
});
