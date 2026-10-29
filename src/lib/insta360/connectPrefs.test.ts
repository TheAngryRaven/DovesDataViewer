import { describe, it, expect } from "vitest";
import { DEFAULT_SSID_PREFIX, loadSsidPrefix, saveSsidPrefix } from "./connectPrefs";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe("Insta360 connect prefs", () => {
  it("starts from a real default prefix, not an empty field", () => {
    expect(loadSsidPrefix(memory())).toBe(DEFAULT_SSID_PREFIX);
  });

  it("remembers the last prefix, trimmed, including a deliberately empty one", () => {
    const s = memory();
    saveSsidPrefix("  X3 ", s);
    expect(loadSsidPrefix(s)).toBe("X3");
    saveSsidPrefix("", s);
    expect(loadSsidPrefix(s)).toBe("");
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(loadSsidPrefix(broken)).toBe(DEFAULT_SSID_PREFIX);
    expect(() => saveSsidPrefix("X4", broken)).not.toThrow();
    expect(loadSsidPrefix(undefined)).toBe(DEFAULT_SSID_PREFIX);
  });
});
