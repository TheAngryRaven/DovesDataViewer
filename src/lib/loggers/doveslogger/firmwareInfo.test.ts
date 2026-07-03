import { describe, expect, it } from "vitest";
import { firmwareInfoFromDeviceInfo, firmwareUpdateCapability } from "./firmwareInfo";
import type { LoggerDeviceInfo } from "../native/ipc";

function makeInfo(fields: Record<string, string>, model?: string): LoggerDeviceInfo {
  return { kind: "doveslogger", name: "BirdsEye", model, fields };
}

describe("firmwareInfoFromDeviceInfo", () => {
  it("reads version and model from the hw.* fields and derives the variant", () => {
    const info = firmwareInfoFromDeviceInfo(
      makeInfo({ "hw.fw": "2.1.0", "hw.model": "BirdsEye-sense", "hw.manufacturer": "DovesDataLogger" }),
    );
    expect(info).toEqual({
      version: "2.1.0",
      model: "BirdsEye-sense",
      variant: "sense",
      manufacturer: "DovesDataLogger",
    });
  });

  it("probes alternate field spellings in priority order", () => {
    expect(firmwareInfoFromDeviceInfo(makeInfo({ firmware: "1.9.0" })).version).toBe("1.9.0");
    expect(firmwareInfoFromDeviceInfo(makeInfo({ version: "1.8.0" })).version).toBe("1.8.0");
    expect(
      firmwareInfoFromDeviceInfo(makeInfo({ "hw.version": "2.0.0", version: "9.9.9" })).version,
    ).toBe("2.0.0");
    expect(firmwareInfoFromDeviceInfo(makeInfo({ model: "BirdsEye-nonsense" })).variant).toBe(
      "nonsense",
    );
  });

  it("falls back to the top-level model when fields lack one", () => {
    const info = firmwareInfoFromDeviceInfo(makeInfo({}, "BirdsEye-sense"));
    expect(info.model).toBe("BirdsEye-sense");
    expect(info.variant).toBe("sense");
  });

  it("returns nulls when nothing is reported (drives the variant-confirm UI)", () => {
    expect(firmwareInfoFromDeviceInfo(makeInfo({}))).toEqual({
      version: null,
      model: null,
      variant: null,
      manufacturer: null,
    });
  });

  it("ignores empty/whitespace field values", () => {
    const info = firmwareInfoFromDeviceInfo(makeInfo({ "hw.fw": "  ", "hw.model": "" }));
    expect(info.version).toBeNull();
    expect(info.model).toBeNull();
  });
});

describe("firmwareUpdateCapability", () => {
  it("is null when the backend doesn't report the capability field", () => {
    expect(firmwareUpdateCapability(makeInfo({}))).toBeNull();
  });

  it("parses truthy and falsy capability values", () => {
    expect(firmwareUpdateCapability(makeInfo({ "cap.fw_update": "1" }))).toBe(true);
    expect(firmwareUpdateCapability(makeInfo({ "cap.fw_update": "true" }))).toBe(true);
    expect(firmwareUpdateCapability(makeInfo({ "cap.fw_update": "0" }))).toBe(false);
    expect(firmwareUpdateCapability(makeInfo({ "cap.fw_update": "false" }))).toBe(false);
  });
});
