import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireNativeConnection,
  nativeConnectionOwner,
  releaseNativeConnection,
} from "./owner";

describe("native connection ownership token", () => {
  beforeEach(() => {
    // Clear whatever a previous test left behind.
    const current = nativeConnectionOwner();
    if (current) releaseNativeConnection(current);
  });

  it("grants the slot to the first acquirer and refuses the second", () => {
    expect(acquireNativeConnection("device-tab")).toBe(true);
    expect(acquireNativeConnection("download")).toBe(false);
    expect(nativeConnectionOwner()).toBe("device-tab");
  });

  it("is idempotent for the same owner", () => {
    expect(acquireNativeConnection("download")).toBe(true);
    expect(acquireNativeConnection("download")).toBe(true);
  });

  it("frees the slot on release", () => {
    acquireNativeConnection("device-tab");
    releaseNativeConnection("device-tab");
    expect(nativeConnectionOwner()).toBeNull();
    expect(acquireNativeConnection("download")).toBe(true);
  });

  it("ignores a release from a non-owner", () => {
    acquireNativeConnection("device-tab");
    releaseNativeConnection("download");
    expect(nativeConnectionOwner()).toBe("device-tab");
  });
});
