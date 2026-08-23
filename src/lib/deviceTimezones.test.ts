import { describe, it, expect } from "vitest";
import {
  MAX_UTC_OFFSET_MINUTES,
  UTC_OFFSET_CHOICES,
  deviceLocalClock,
  formatClock12,
  formatUtcOffset,
  isValidUtcOffsetMinutes,
  localHourOptions,
  localUtcOffsetMinutes,
  offsetChoicesIncluding,
  parseUtcOffsetMinutes,
  utcOffsetLabel,
} from "./deviceTimezones";

describe("UTC_OFFSET_CHOICES", () => {
  it("is sorted west to east with unique offsets", () => {
    const minutes = UTC_OFFSET_CHOICES.map((c) => c.minutes);
    expect(new Set(minutes).size).toBe(minutes.length);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it("stays inside the band the firmware accepts", () => {
    for (const choice of UTC_OFFSET_CHOICES) {
      expect(isValidUtcOffsetMinutes(choice.minutes), formatUtcOffset(choice.minutes)).toBe(true);
    }
  });

  // Minutes, not hours: an hours-only list is wrong for real places.
  it("includes the half- and quarter-hour offsets", () => {
    const minutes = UTC_OFFSET_CHOICES.map((c) => c.minutes);
    expect(minutes).toContain(330); // India +5:30
    expect(minutes).toContain(345); // Nepal +5:45
    expect(minutes).toContain(-210); // Newfoundland -3:30
    expect(minutes).toContain(765); // Chatham Islands +12:45
  });

  it("spans the real-world extremes", () => {
    expect(UTC_OFFSET_CHOICES[0].minutes).toBe(-720);
    expect(UTC_OFFSET_CHOICES[UTC_OFFSET_CHOICES.length - 1].minutes).toBe(
      MAX_UTC_OFFSET_MINUTES,
    );
  });

  it("names places for every offset", () => {
    for (const choice of UTC_OFFSET_CHOICES) {
      expect(choice.places.length, formatUtcOffset(choice.minutes)).toBeGreaterThan(0);
    }
  });
});

describe("isValidUtcOffsetMinutes", () => {
  it("accepts the ±14 h band and rejects everything outside it", () => {
    expect(isValidUtcOffsetMinutes(0)).toBe(true);
    expect(isValidUtcOffsetMinutes(840)).toBe(true);
    expect(isValidUtcOffsetMinutes(-840)).toBe(true);
    expect(isValidUtcOffsetMinutes(841)).toBe(false);
    expect(isValidUtcOffsetMinutes(-841)).toBe(false);
  });

  it("rejects fractional minutes", () => {
    expect(isValidUtcOffsetMinutes(30.5)).toBe(false);
    expect(isValidUtcOffsetMinutes(NaN)).toBe(false);
  });
});

describe("parseUtcOffsetMinutes", () => {
  it("parses a stored integer, signed or not", () => {
    expect(parseUtcOffsetMinutes("-360")).toBe(-360);
    expect(parseUtcOffsetMinutes("330")).toBe(330);
    expect(parseUtcOffsetMinutes("+60")).toBe(60);
    expect(parseUtcOffsetMinutes(" 0 ")).toBe(0);
  });

  // The firmware's setting_parse::parseIntSetting rejects these too, and falls
  // back to UTC. Reporting them as "no offset" keeps the UI honest about that.
  it("rejects anything that isn't a whole number in band", () => {
    expect(parseUtcOffsetMinutes("")).toBeNull();
    expect(parseUtcOffsetMinutes("-5:30")).toBeNull();
    expect(parseUtcOffsetMinutes("1.5")).toBeNull();
    expect(parseUtcOffsetMinutes("abc")).toBeNull();
    expect(parseUtcOffsetMinutes("900")).toBeNull();
  });
});

describe("formatUtcOffset", () => {
  it("renders sign, hours and minutes", () => {
    expect(formatUtcOffset(0)).toBe("UTC+00:00");
    expect(formatUtcOffset(-360)).toBe("UTC-06:00");
    expect(formatUtcOffset(330)).toBe("UTC+05:30");
    expect(formatUtcOffset(-210)).toBe("UTC-03:30");
    expect(formatUtcOffset(765)).toBe("UTC+12:45");
    expect(formatUtcOffset(840)).toBe("UTC+14:00");
  });
});

describe("utcOffsetLabel", () => {
  it("appends the places for a known offset", () => {
    expect(utcOffsetLabel(330)).toBe("UTC+05:30 · India, Sri Lanka");
  });

  it("falls back to the bare offset for one the list doesn't have", () => {
    expect(utcOffsetLabel(7)).toBe("UTC+00:07");
  });
});

describe("localUtcOffsetMinutes", () => {
  it("inverts the JS sign convention (getTimezoneOffset counts west as positive)", () => {
    const fake = { getTimezoneOffset: () => 360 } as Date; // UTC-06:00
    expect(localUtcOffsetMinutes(fake)).toBe(-360);
  });
});

describe("offsetChoicesIncluding", () => {
  it("returns the plain list for a known offset or no offset at all", () => {
    expect(offsetChoicesIncluding(-360)).toBe(UTC_OFFSET_CHOICES);
    expect(offsetChoicesIncluding(null)).toBe(UTC_OFFSET_CHOICES);
  });

  // Dropping a value the device actually holds would silently rewrite the
  // user's setting on the next save.
  it("splices an unknown device offset in at its proper place", () => {
    const choices = offsetChoicesIncluding(-350);
    expect(choices).toHaveLength(UTC_OFFSET_CHOICES.length + 1);
    const index = choices.findIndex((c) => c.minutes === -350);
    expect(choices[index - 1].minutes).toBe(-360);
    expect(choices[index + 1].minutes).toBe(-300);
    expect(UTC_OFFSET_CHOICES.some((c) => c.minutes === -350)).toBe(false);
  });
});

describe("formatClock12", () => {
  it("maps the 24-hour clock onto 12-hour with AM/PM", () => {
    expect(formatClock12(0, 0)).toBe("12:00 AM");
    expect(formatClock12(7, 5)).toBe("7:05 AM");
    expect(formatClock12(12, 0)).toBe("12:00 PM");
    expect(formatClock12(19, 30)).toBe("7:30 PM");
    expect(formatClock12(23, 59)).toBe("11:59 PM");
  });
});

describe("deviceLocalClock", () => {
  const utcNoon = new Date("2026-08-23T12:00:00Z");

  it("shifts UTC by the offset", () => {
    expect(deviceLocalClock(utcNoon, 0)).toBe("12:00 PM");
    expect(deviceLocalClock(utcNoon, -360)).toBe("6:00 AM");
    expect(deviceLocalClock(utcNoon, 330)).toBe("5:30 PM");
  });

  // The whole point of the offset: a US Central driver at 07:30 local is at
  // 12:30 UTC, which a naive UTC gate calls the middle of the night.
  it("rolls the date backwards and forwards without breaking the clock", () => {
    expect(deviceLocalClock(new Date("2026-08-23T02:00:00Z"), -360)).toBe("8:00 PM");
    expect(deviceLocalClock(new Date("2026-08-23T23:00:00Z"), 480)).toBe("7:00 AM");
  });
});

describe("localHourOptions", () => {
  it("offers all 24 hours, stored as bare hour numbers", () => {
    const options = localHourOptions();
    expect(options).toHaveLength(24);
    expect(options[0]).toEqual({ value: "0", label: "12:00 AM" });
    expect(options[7]).toEqual({ value: "7", label: "7:00 AM" });
    expect(options[23]).toEqual({ value: "23", label: "11:00 PM" });
  });
});
