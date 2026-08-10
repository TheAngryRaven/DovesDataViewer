import { describe, it, expect } from "vitest";
import { xrkFileName, csvFileName } from "./fileNaming";

describe("xrkFileName", () => {
  it("swaps a trailing .xrz for .xrk instead of stacking extensions", () => {
    expect(xrkFileName("a_0217.xrz")).toBe("a_0217.xrk");
    expect(xrkFileName("A_0217.XRZ")).toBe("A_0217.xrk");
  });

  it("leaves names that are already .xrk alone", () => {
    expect(xrkFileName("a_0217.xrk")).toBe("a_0217.xrk");
    expect(xrkFileName("A_0217.XRK")).toBe("A_0217.XRK");
  });

  it("appends .xrk to extensionless names", () => {
    expect(xrkFileName("a_0217")).toBe("a_0217.xrk");
  });
});

describe("csvFileName", () => {
  it("appends .csv to bare session ids", () => {
    expect(csvFileName("00A3F2")).toBe("00A3F2.csv");
  });

  it("leaves names that are already .csv alone", () => {
    expect(csvFileName("session.csv")).toBe("session.csv");
    expect(csvFileName("SESSION.CSV")).toBe("SESSION.CSV");
  });
});
