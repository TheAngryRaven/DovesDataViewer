import { describe, expect, it } from "vitest";
import {
  fileExtension,
  mergeShareIntoIndexData,
  shareToken,
  shareUrl,
  shouldAutoPublish,
} from "./shareState";

describe("shouldAutoPublish", () => {
  it("publishes only when the default is public and there is no share history", () => {
    expect(shouldAutoPublish(true, undefined)).toBe(true);
    expect(shouldAutoPublish(false, undefined)).toBe(false);
    // Already shared — nothing to do.
    expect(shouldAutoPublish(true, { token: "abc" })).toBe(false);
    expect(shouldAutoPublish(false, { token: "abc" })).toBe(false);
    // Explicit opt-out must never resurrect.
    expect(shouldAutoPublish(true, { optedOut: true })).toBe(false);
    expect(shouldAutoPublish(false, { optedOut: true })).toBe(false);
  });
});

describe("shareToken", () => {
  it("extracts a live token and nothing else", () => {
    expect(shareToken({ token: "abc" })).toBe("abc");
    expect(shareToken({ optedOut: true })).toBeNull();
    expect(shareToken(undefined)).toBeNull();
  });
});

describe("mergeShareIntoIndexData", () => {
  it("preserves size and unrelated fields", () => {
    const merged = mergeShareIntoIndexData({ size: 123, other: "x" }, { token: "t" });
    expect(merged).toEqual({ size: 123, other: "x", share: { token: "t" } });
  });

  it("overwrites a previous share state", () => {
    const merged = mergeShareIntoIndexData({ size: 1, share: { token: "t" } }, { optedOut: true });
    expect(merged).toEqual({ size: 1, share: { optedOut: true } });
  });

  it("clears the share field on null", () => {
    const merged = mergeShareIntoIndexData({ size: 1, share: { token: "t" } }, null);
    expect(merged).toEqual({ size: 1 });
  });

  it("tolerates a missing data object", () => {
    expect(mergeShareIntoIndexData(undefined, { token: "t" })).toEqual({ share: { token: "t" } });
    expect(mergeShareIntoIndexData(null, null)).toEqual({});
  });
});

describe("shareUrl", () => {
  it("builds the /s/ path", () => {
    expect(shareUrl("https://lapwingdata.com", "abc123")).toBe("https://lapwingdata.com/s/abc123");
  });
});

describe("fileExtension", () => {
  it("lower-cases the extension without the dot", () => {
    expect(fileExtension("session.DOVEX")).toBe("dovex");
    expect(fileExtension("a.b.nmea")).toBe("nmea");
  });

  it("returns empty for no / hidden / trailing-dot names", () => {
    expect(fileExtension("noext")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
  });
});
