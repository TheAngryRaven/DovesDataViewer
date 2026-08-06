import { describe, it, expect } from "vitest";
import {
  isDeviceGeneratedName,
  isDeviceGeneratedShortName,
  parseDeviceGeneratedName,
} from "./deviceGeneratedNames";

describe("isDeviceGeneratedName", () => {
  it("accepts the firmware's N{YYMMDD}_{HHMM} format", () => {
    expect(isDeviceGeneratedName("N260803_1432")).toBe(true);
    expect(isDeviceGeneratedName("N260101_0000")).toBe(true);
    expect(isDeviceGeneratedName("N261231_2359")).toBe(true);
  });

  it("rejects names a user would have chosen", () => {
    expect(isDeviceGeneratedName("Sunset Park")).toBe(false);
    expect(isDeviceGeneratedName("Orlando Kart Center")).toBe(false);
    expect(isDeviceGeneratedName("Full CW")).toBe(false);
  });

  // Without validating the parts, a name that merely looks the part would be
  // treated as a placeholder and the user pushed to rename something they named.
  it("rejects the shape when the date or time is impossible", () => {
    expect(isDeviceGeneratedName("N261301_1200")).toBe(false); // month 13
    expect(isDeviceGeneratedName("N260230_1200")).toBe(false); // Feb 30
    expect(isDeviceGeneratedName("N260803_2460")).toBe(false); // 24:60
    expect(isDeviceGeneratedName("N260803_1260")).toBe(false); // minute 60
  });

  it("accepts Feb 29 in a leap year and rejects it otherwise", () => {
    expect(isDeviceGeneratedName("N280229_1200")).toBe(true); // 2028
    expect(isDeviceGeneratedName("N260229_1200")).toBe(false); // 2026
  });

  it("rejects near misses on the shape", () => {
    expect(isDeviceGeneratedName("260803_1432")).toBe(false); // no N
    expect(isDeviceGeneratedName("N260803-1432")).toBe(false); // wrong separator
    expect(isDeviceGeneratedName("N2608031432")).toBe(false); // no separator
    expect(isDeviceGeneratedName("N260803_143")).toBe(false); // short time
    expect(isDeviceGeneratedName("xN260803_1432")).toBe(false); // prefixed
    expect(isDeviceGeneratedName("N260803_1432x")).toBe(false); // suffixed
  });

  it("handles empty and nullish input", () => {
    expect(isDeviceGeneratedName("")).toBe(false);
    expect(isDeviceGeneratedName(undefined)).toBe(false);
    expect(isDeviceGeneratedName(null)).toBe(false);
  });
});

describe("parseDeviceGeneratedName", () => {
  // UTC, because that is the clock the GPS stamped it from.
  it("recovers the moment the course was walked", () => {
    const d = parseDeviceGeneratedName("N260803_1432")!;
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(7); // August
    expect(d.getUTCDate()).toBe(3);
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(32);
  });

  it("returns null for anything that isn't a generated name", () => {
    expect(parseDeviceGeneratedName("Sunset Park")).toBeNull();
    expect(parseDeviceGeneratedName("N261301_1200")).toBeNull();
  });
});

describe("isDeviceGeneratedShortName", () => {
  it("accepts the firmware's MMDDHHMM format", () => {
    expect(isDeviceGeneratedShortName("08031432")).toBe(true);
    expect(isDeviceGeneratedShortName("12312359")).toBe(true);
  });

  it("rejects a short name a user would have chosen", () => {
    expect(isDeviceGeneratedShortName("OKC")).toBe(false);
    expect(isDeviceGeneratedShortName("SUNSET")).toBe(false);
  });

  it("rejects impossible dates and times", () => {
    expect(isDeviceGeneratedShortName("13011200")).toBe(false); // month 13
    expect(isDeviceGeneratedShortName("08032460")).toBe(false); // 24:60
  });

  it("rejects wrong lengths", () => {
    expect(isDeviceGeneratedShortName("0803143")).toBe(false);
    expect(isDeviceGeneratedShortName("080314322")).toBe(false);
    expect(isDeviceGeneratedShortName("")).toBe(false);
    expect(isDeviceGeneratedShortName(undefined)).toBe(false);
  });

  // The two checks are independent: renaming the track doesn't rename the short
  // name, and the sync flow has to be able to tell which half still needs work.
  it("is independent of the long-name check", () => {
    expect(isDeviceGeneratedName("08031432")).toBe(false);
    expect(isDeviceGeneratedShortName("N260803_1432")).toBe(false);
  });
});
