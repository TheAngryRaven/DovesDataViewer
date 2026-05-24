import { describe, it, expect } from "vitest";
import { fileSyncStatus, cloudOnlyNames } from "./fileSync";

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
