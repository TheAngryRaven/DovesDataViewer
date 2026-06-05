import { describe, it, expect } from "vitest";
import { mapXrkToParsedData, parseXrkStartDate } from "./xrkMapping";
import type { XrkRawResult } from "./xrkTypes";
import { MPS_TO_MPH, KPH_TO_MPS } from "../parserUtils";

// A tiny synthetic session loosely modelled on libxrk's real output (channel
// names + units taken from a parsed AiM test log).
function makeRaw(overrides: Partial<XrkRawResult> = {}): XrkRawResult {
  return {
    timecodes: new Float64Array([1000, 1100, 1200]),
    channels: [
      { name: "GPS Latitude", unit: "deg", values: new Float64Array([45.1, 45.2, 45.3]) },
      { name: "GPS Longitude", unit: "deg", values: new Float64Array([-75.1, -75.2, -75.3]) },
      { name: "GPS Speed", unit: "m/s", values: new Float64Array([10, 20, 30]) },
      { name: "RPM", unit: "rpm", values: new Float64Array([5000, 6000, 7000]) },
      { name: "GPS_LateralAcc", unit: "g", values: new Float64Array([0.1, 0.2, 0.3]) },
      { name: "GPS_InlineAcc", unit: "g", values: new Float64Array([-0.1, -0.2, -0.3]) },
    ],
    metadata: {},
    laps: { num: [], start: [], end: [] },
    ...overrides,
  };
}

describe("mapXrkToParsedData", () => {
  it("folds GPS primaries into samples and rebases time to zero", () => {
    const data = mapXrkToParsedData(makeRaw(), "test.xrk");
    expect(data.samples).toHaveLength(3);
    expect(data.samples[0].t).toBe(0);
    expect(data.samples[2].t).toBe(200);
    expect(data.samples[1].lat).toBeCloseTo(45.2);
    expect(data.samples[1].lon).toBeCloseTo(-75.2);
    expect(data.duration).toBe(200);
  });

  it("treats GPS Speed as m/s when the unit says so", () => {
    const data = mapXrkToParsedData(makeRaw(), "test.xrk");
    expect(data.samples[1].speedMps).toBeCloseTo(20);
    expect(data.samples[1].speedMph).toBeCloseTo(20 * MPS_TO_MPH);
  });

  it("converts km/h GPS Speed to m/s", () => {
    const raw = makeRaw();
    raw.channels[2] = { name: "GPS Speed", unit: "km/h", values: new Float64Array([36, 72, 108]) };
    const data = mapXrkToParsedData(raw, "test.xrk");
    expect(data.samples[0].speedMps).toBeCloseTo(36 * KPH_TO_MPS); // 10 m/s
    expect(data.samples[2].speedMps).toBeCloseTo(108 * KPH_TO_MPS); // 30 m/s
  });

  it("maps known AiM channels to the app's human labels (extraFields)", () => {
    const data = mapXrkToParsedData(makeRaw(), "test.xrk");
    const ef = data.samples[0].extraFields;
    expect(ef["RPM"]).toBe(5000);
    expect(ef["Lateral G"]).toBeCloseTo(0.1);
    expect(ef["Longitudinal G"]).toBeCloseTo(-0.1);
    // Speed/lat/lon must NOT leak into extraFields.
    expect(ef["GPS Speed"]).toBeUndefined();
    const names = data.fieldMappings.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["RPM", "Lateral G", "Longitudinal G"]));
  });

  it("passes unknown channels through under their own name + unit", () => {
    const raw = makeRaw();
    raw.channels.push({ name: "Luminosity", unit: "%", values: new Float64Array([0.4, 0.5, 0.6]) });
    const data = mapXrkToParsedData(raw, "test.xrk");
    expect(data.samples[0].extraFields["Luminosity"]).toBeCloseTo(0.4);
    const lum = data.fieldMappings.find((f) => f.name === "Luminosity");
    expect(lum?.unit).toBe("%");
  });

  it("does NOT synthesize G when the log already carries it", () => {
    const data = mapXrkToParsedData(makeRaw(), "test.xrk");
    // Our synthetic values are preserved (not overwritten by GPS-derived G).
    expect(data.samples[2].extraFields["Lateral G"]).toBeCloseTo(0.3);
    expect(data.samples[0].extraFields).not.toHaveProperty("Lat G");
  });

  it("derives G from GPS when neither native nor GPS-derived G is present", () => {
    const raw = makeRaw();
    raw.channels = raw.channels.filter((c) => !/Acc$/.test(c.name)); // drop the g channels
    const data = mapXrkToParsedData(raw, "test.xrk");
    // applyGForceCalculations writes "Lat G"/"Lon G".
    expect(data.samples[0].extraFields).toHaveProperty("Lat G");
    expect(data.samples[0].extraFields).toHaveProperty("Lon G");
  });

  it("skips rows with invalid GPS coordinates", () => {
    const raw = makeRaw();
    raw.channels[0].values = new Float64Array([0, 45.2, 45.3]); // first row lat=0 -> invalid
    raw.channels[1].values = new Float64Array([0, -75.2, -75.3]);
    const data = mapXrkToParsedData(raw, "test.xrk");
    expect(data.samples).toHaveLength(2);
    expect(data.samples[0].t).toBe(100); // rebased to the first *valid* sample
  });

  it("computes bounds across valid samples", () => {
    const data = mapXrkToParsedData(makeRaw(), "test.xrk");
    expect(data.bounds.minLat).toBeCloseTo(45.1);
    expect(data.bounds.maxLat).toBeCloseTo(45.3);
    expect(data.bounds.minLon).toBeCloseTo(-75.3);
    expect(data.bounds.maxLon).toBeCloseTo(-75.1);
  });

  it("throws clearly when there are no samples", () => {
    expect(() => mapXrkToParsedData(makeRaw({ timecodes: new Float64Array() }), "x.xrk")).toThrow(
      /no samples/i,
    );
  });

  it("throws when GPS lat/lon channels are missing", () => {
    const raw = makeRaw();
    raw.channels = raw.channels.filter((c) => !c.name.startsWith("GPS L"));
    expect(() => mapXrkToParsedData(raw, "x.xrk")).toThrow(/Latitude\/Longitude/i);
  });
});

describe("parseXrkStartDate", () => {
  it("combines libxrk's separate Log Date + Log Time into one timestamp", () => {
    const d = parseXrkStartDate({ "Log Date": "11/04/2025", "Log Time": "15:50:07" });
    expect(d?.getFullYear()).toBe(2025);
    expect(d?.getMonth()).toBe(10); // November
    expect(d?.getDate()).toBe(4);
    expect(d?.getHours()).toBe(15); // time of day preserved, not midnight
    expect(d?.getMinutes()).toBe(50);
  });

  it("falls back to a date-only value when there's no time", () => {
    const d = parseXrkStartDate({ "Log Date": "01/23/2016" });
    expect(d?.getFullYear()).toBe(2016);
    expect(d?.getHours()).toBe(0);
  });

  it("parses a string date from metadata", () => {
    const d = parseXrkStartDate({ Date: "2025-11-04 15:50:00" });
    expect(d?.getFullYear()).toBe(2025);
  });

  it("parses epoch seconds", () => {
    const d = parseXrkStartDate({ datetime: 1700000000 });
    expect(d?.getTime()).toBe(1700000000 * 1000);
  });

  it("returns undefined when nothing parseable is present", () => {
    expect(parseXrkStartDate({})).toBeUndefined();
    expect(parseXrkStartDate({ Venue: "Adria Kart" })).toBeUndefined();
  });
});
