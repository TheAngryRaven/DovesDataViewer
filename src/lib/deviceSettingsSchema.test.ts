import { describe, it, expect } from "vitest";
import {
  DEVICE_SETTINGS_SCHEMA,
  DEVICE_SETTING_GROUPS,
  getSettingDef,
  getSettingGroup,
  groupSettingRows,
  isAdvancedSetting,
  validateSettingValue,
  settingDisplayValue,
  settingNotice,
} from "./deviceSettingsSchema";

// ─── schema shape ─────────────────────────────────────────────────────────────

describe("DEVICE_SETTINGS_SCHEMA", () => {
  it("has unique keys", () => {
    const keys = DEVICE_SETTINGS_SCHEMA.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every def has a non-empty label and a valid type", () => {
    for (const d of DEVICE_SETTINGS_SCHEMA) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(["string", "number", "enum", "timezone"]).toContain(d.type);
    }
  });

  it("includes the known device keys", () => {
    const keys = DEVICE_SETTINGS_SCHEMA.map((d) => d.key);
    expect(keys).toContain("device_name");
    expect(keys).toContain("bluetooth_name");
    expect(keys).toContain("bluetooth_pin");
    expect(keys).toContain("lap_detection_distance");
    expect(keys).toContain("use_legacy_csv");
  });

  // Firmware 4.1.0 ships the NeoPixel strip and the local-timezone offset on
  // every build (logger plans 0006/0007/0010). Without schema entries they
  // rendered as raw text boxes with no range checking at all.
  it("covers the LED strip and timezone keys the logger ships", () => {
    const keys = DEVICE_SETTINGS_SCHEMA.map((d) => d.key);
    expect(keys).toContain("utc_offset_min");
    expect(keys).toContain("led_brightness");
    expect(keys).toContain("led_brightness_night");
    expect(keys).toContain("led_day_start_hour");
    expect(keys).toContain("led_night_start_hour");
    expect(keys).toContain("rev_limit");
    expect(keys).toContain("overrev_limit");
    expect(keys).toContain("temp1_alert_c");
    expect(keys).toContain("tach_filter");
  });

  it("only files settings under a declared group", () => {
    const groupIds = DEVICE_SETTING_GROUPS.map((g) => g.id);
    for (const d of DEVICE_SETTINGS_SCHEMA) {
      if (d.group) expect(groupIds, `${d.key}`).toContain(d.group);
    }
  });

  it("defines device_name as a 32-character string field", () => {
    const def = getSettingDef("device_name");
    expect(def?.type).toBe("string");
    expect(def?.maxLength).toBe(32);
  });

  it("rejects a device_name over 32 characters", () => {
    expect(validateSettingValue("device_name", "x".repeat(32))).toBeNull();
    expect(validateSettingValue("device_name", "x".repeat(33))).toBe(
      "Maximum 32 characters"
    );
  });
});

// ─── getSettingDef ──────────────────────────────────────────────────────────

describe("getSettingDef", () => {
  it("returns the def for a known key", () => {
    const def = getSettingDef("driver_name");
    expect(def).not.toBeNull();
    expect(def?.label).toBe("Driver Name");
    expect(def?.type).toBe("string");
    expect(def?.maxLength).toBe(30);
  });

  it("returns null for an unknown key", () => {
    expect(getSettingDef("nonexistent_key")).toBeNull();
  });

  it("is case-sensitive (does not match wrong casing)", () => {
    expect(getSettingDef("BLUETOOTH_NAME")).toBeNull();
  });
});

// ─── validateSettingValue: unknown keys ─────────────────────────────────────

describe("validateSettingValue — unknown keys", () => {
  it("returns null (no validation) for unknown keys, even garbage values", () => {
    expect(validateSettingValue("mystery", "anything at all")).toBeNull();
    expect(validateSettingValue("mystery", "")).toBeNull();
  });
});

// ─── validateSettingValue: number type ──────────────────────────────────────

describe("validateSettingValue — number fields", () => {
  it("accepts an in-range integer", () => {
    expect(validateSettingValue("lap_detection_distance", "25")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(validateSettingValue("lap_detection_distance", "abc")).toBe(
      "Must be a whole number"
    );
  });

  it("rejects a fractional value (whole numbers only)", () => {
    expect(validateSettingValue("lap_detection_distance", "10.5")).toBe(
      "Must be a whole number"
    );
  });

  it("enforces the minimum", () => {
    // lap_detection_distance min = 1
    expect(validateSettingValue("lap_detection_distance", "0")).toBe(
      "Minimum value is 1"
    );
  });

  it("enforces the maximum", () => {
    // lap_detection_distance max = 50
    expect(validateSettingValue("lap_detection_distance", "51")).toBe(
      "Maximum value is 50"
    );
  });

  it("accepts the exact boundary values", () => {
    expect(validateSettingValue("lap_detection_distance", "1")).toBeNull();
    expect(validateSettingValue("lap_detection_distance", "50")).toBeNull();
  });

  it("accepts a negative integer when min allows it (use_legacy_csv min 0 still 0)", () => {
    // use_legacy_csv: 0 and 1 valid, 2 too big, -1 below min
    expect(validateSettingValue("use_legacy_csv", "0")).toBeNull();
    expect(validateSettingValue("use_legacy_csv", "1")).toBeNull();
    expect(validateSettingValue("use_legacy_csv", "2")).toBe("Maximum value is 1");
    expect(validateSettingValue("use_legacy_csv", "-1")).toBe("Minimum value is 0");
  });

  it("enforces maxLength (digit count) on numeric fields like bluetooth_pin", () => {
    // bluetooth_pin: min 0, max 9999, maxLength 4
    expect(validateSettingValue("bluetooth_pin", "1234")).toBeNull();
    // 5 digits: caught by max (9999) before maxLength
    expect(validateSettingValue("bluetooth_pin", "12345")).toBe(
      "Maximum value is 9999"
    );
  });

  // Number("") is 0, so an empty box used to validate as a real zero — fine
  // for lap_detection_distance (min 1 caught it) but NOT for the fields whose
  // range includes 0: an empty bluetooth_pin or led_brightness sailed through
  // and was written to the device verbatim. The firmware's own
  // setting_parse::parseIntSetting rejects "" too.
  it("rejects an empty value rather than reading it as 0", () => {
    expect(validateSettingValue("lap_detection_distance", "")).toBe(
      "Must be a whole number"
    );
    expect(validateSettingValue("bluetooth_pin", "")).toBe("Must be a whole number");
    expect(validateSettingValue("led_brightness", "")).toBe("Must be a whole number");
  });
});

// ─── validateSettingValue: string type ──────────────────────────────────────

describe("validateSettingValue — string fields", () => {
  it("accepts a short string", () => {
    expect(validateSettingValue("driver_name", "Mike")).toBeNull();
  });

  it("accepts an empty string (no min length)", () => {
    expect(validateSettingValue("driver_name", "")).toBeNull();
  });

  it("accepts exactly maxLength characters", () => {
    expect(validateSettingValue("driver_name", "x".repeat(30))).toBeNull();
  });

  it("rejects a string over maxLength", () => {
    expect(validateSettingValue("driver_name", "x".repeat(31))).toBe(
      "Maximum 30 characters"
    );
  });

  it("does not apply numeric validation to string fields", () => {
    // bluetooth_name is a string — non-numeric content is fine
    expect(validateSettingValue("bluetooth_name", "My Logger!")).toBeNull();
  });
});

// ─── enum fields ──────────────────────────────────────────────────────────────

describe("validateSettingValue — enum fields", () => {
  it("accepts every declared option", () => {
    expect(validateSettingValue("display_invert", "normal")).toBeNull();
    expect(validateSettingValue("display_invert", "inverted")).toBeNull();
    expect(validateSettingValue("debug_pages", "hide")).toBeNull();
    expect(validateSettingValue("debug_pages", "show")).toBeNull();
    expect(validateSettingValue("race_mode", "circuit")).toBeNull();
    expect(validateSettingValue("race_mode", "sprint")).toBeNull();
    expect(validateSettingValue("spark_mode", "wasted")).toBeNull();
    expect(validateSettingValue("spark_mode", "single")).toBeNull();
  });

  // The whole point of the type: as a free-text field a typo reached the device
  // and the firmware silently fell back to its default, which reads as the
  // setting simply not working.
  it("rejects a value that isn't an option", () => {
    expect(validateSettingValue("race_mode", "Circuit")).toBe(
      "Must be one of: circuit, sprint",
    );
    expect(validateSettingValue("spark_mode", "wastedd")).toBe(
      "Must be one of: wasted, single",
    );
  });

  it("rejects an empty value", () => {
    expect(validateSettingValue("race_mode", "")).toBe("Must be one of: circuit, sprint");
  });

  it("is case-sensitive, because the device compares the literal", () => {
    expect(validateSettingValue("spark_mode", "WASTED")).not.toBeNull();
  });
});

describe("enum schema entries", () => {
  it("gives every enum at least one option", () => {
    for (const def of DEVICE_SETTINGS_SCHEMA.filter((d) => d.type === "enum")) {
      expect(def.options, `${def.key} needs options`).toBeTruthy();
      expect(def.options!.length, `${def.key} needs options`).toBeGreaterThan(0);
    }
  });

  it("keeps option values unique within a setting", () => {
    for (const def of DEVICE_SETTINGS_SCHEMA.filter((d) => d.type === "enum")) {
      const values = def.options!.map((o) => o.value);
      expect(new Set(values).size, `${def.key} has duplicate values`).toBe(values.length);
    }
  });
});

// ─── isAdvancedSetting ────────────────────────────────────────────────────────

describe("isAdvancedSetting", () => {
  it("flags detection thresholds, debug pages and the legacy-CSV switch", () => {
    expect(isAdvancedSetting("lap_detection_distance")).toBe(true);
    expect(isAdvancedSetting("waypoint_detection_distance")).toBe(true);
    expect(isAdvancedSetting("waypoint_speed")).toBe(true);
    expect(isAdvancedSetting("debug_pages")).toBe(true);
    expect(isAdvancedSetting("use_legacy_csv")).toBe(true);
  });

  it("keeps everyday settings in the normal list", () => {
    expect(isAdvancedSetting("device_name")).toBe(false);
    expect(isAdvancedSetting("bluetooth_name")).toBe(false);
    expect(isAdvancedSetting("bluetooth_pin")).toBe(false);
    expect(isAdvancedSetting("driver_name")).toBe(false);
    expect(isAdvancedSetting("race_mode")).toBe(false);
    expect(isAdvancedSetting("display_invert")).toBe(false);
    expect(isAdvancedSetting("spark_mode")).toBe(false);
    expect(isAdvancedSetting("cylinder_count")).toBe(false);
    expect(isAdvancedSetting("utc_offset_min")).toBe(false);
  });

  it("does not call the LED settings advanced — they have their own section", () => {
    expect(isAdvancedSetting("led_brightness")).toBe(false);
    expect(isAdvancedSetting("led_night_start_hour")).toBe(false);
    expect(getSettingGroup("led_brightness")).toBe("leds");
  });

  // A newer firmware can send keys this build has no schema for. The default is
  // "normal unless flagged", so an unknown key must stay visible in the main
  // list, not vanish into a collapsed section.
  it("treats unknown keys as normal", () => {
    expect(isAdvancedSetting("some_future_setting")).toBe(false);
  });
});

describe("settingDisplayValue", () => {
  it("maps a known enum value to its label", () => {
    expect(settingDisplayValue("race_mode", "sprint")).toBe("Sprint");
  });

  // A device can hold a value this build doesn't know — older/newer firmware, or
  // a hand-edited SETTINGS.json. Showing it verbatim keeps that visible instead
  // of silently rendering it as an option we do know.
  it("passes an unrecognised value through untouched", () => {
    expect(settingDisplayValue("race_mode", "drag")).toBe("drag");
  });

  it("leaves non-enum settings alone", () => {
    expect(settingDisplayValue("driver_name", "Mike")).toBe("Mike");
    expect(settingDisplayValue("unknown_key", "whatever")).toBe("whatever");
  });
});

// ─── the new plan-0003 settings ───────────────────────────────────────────────

describe("cylinder_count", () => {
  it("accepts a plausible cylinder count", () => {
    expect(validateSettingValue("cylinder_count", "1")).toBeNull();
    expect(validateSettingValue("cylinder_count", "2")).toBeNull();
    // A V8 is entered as a V8 (logger plan 0012). Before it, the field meant
    // "cylinders the pickup sees" and this user was told to type 1.
    expect(validateSettingValue("cylinder_count", "8")).toBeNull();
  });

  it("rejects zero — not a describable engine", () => {
    expect(validateSettingValue("cylinder_count", "0")).toBe("Minimum value is 1");
  });

  it("rejects a fractional count", () => {
    expect(validateSettingValue("cylinder_count", "1.5")).toBe("Must be a whole number");
  });

  it("no longer claims to scale RPM — spark_mode is the only thing that does", () => {
    // Guards the copy, because the wrong copy here IS the bug: it is what sent
    // a V8 owner to type 1 in a field labelled Cylinders.
    expect(getSettingDef("cylinder_count")?.description).not.toMatch(/pickup sees/i);
    expect(getSettingDef("spark_mode")?.description).toMatch(/only setting that scales RPM/i);
  });
});

describe("settingNotice", () => {
  it("warns that multi-cylinder RPM is inferred from ignition pulses", () => {
    const notice = settingNotice("cylinder_count", "8");
    expect(notice).toMatch(/8 cylinders/);
    expect(notice).toMatch(/inferred/i);
  });

  it("says nothing on a single — its every firing IS the crank turning", () => {
    expect(settingNotice("cylinder_count", "1")).toBeNull();
  });

  it("says nothing for a value it cannot read, rather than guessing", () => {
    expect(settingNotice("cylinder_count", "")).toBeNull();
    expect(settingNotice("cylinder_count", "  ")).toBeNull();
    expect(settingNotice("cylinder_count", "eight")).toBeNull();
    expect(settingNotice("cylinder_count", "2.5")).toBeNull();
    expect(settingNotice("cylinder_count", "0")).toBeNull();
  });

  it("has nothing to say about any other key", () => {
    expect(settingNotice("spark_mode", "single")).toBeNull();
    expect(settingNotice("rev_limit", "15000")).toBeNull();
    expect(settingNotice("not_a_real_key", "8")).toBeNull();
  });
});

describe("display_invert", () => {
  // The firmware treats anything that is not an exact "inverted" as normal, so
  // a value this app lets through unchecked would read as the setting silently
  // doing nothing.
  it("rejects near misses the firmware would ignore", () => {
    expect(validateSettingValue("display_invert", "invert")).not.toBeNull();
    expect(validateSettingValue("display_invert", "Inverted")).not.toBeNull();
    expect(validateSettingValue("display_invert", "1")).not.toBeNull();
  });

  it("labels the stored values for display", () => {
    expect(settingDisplayValue("display_invert", "inverted")).toBe("Inverted (black on white)");
  });
});

describe("debug_pages", () => {
  // The firmware shows the diagnostic pages only on an exact "show" — any
  // other value silently means hidden, so near misses must be rejected here.
  it("rejects near misses the firmware would ignore", () => {
    expect(validateSettingValue("debug_pages", "Show")).not.toBeNull();
    expect(validateSettingValue("debug_pages", "hidden")).not.toBeNull();
    expect(validateSettingValue("debug_pages", "1")).not.toBeNull();
  });

  it("labels the stored values for display", () => {
    expect(settingDisplayValue("debug_pages", "hide")).toBe("Hidden (racing pages only)");
    expect(settingDisplayValue("debug_pages", "show")).toBe("Shown (GPS/RF diagnostics first)");
  });
});

// ─── grouping ─────────────────────────────────────────────────────────────────

describe("groupSettingRows", () => {
  const rowsFor = (...keys: string[]) => keys.map((key) => ({ key }));

  it("keeps unfiled and unknown keys in the main list", () => {
    const { main, groups } = groupSettingRows(
      rowsFor("device_name", "utc_offset_min", "some_future_setting"),
      (r) => r.key,
    );
    expect(main.map((r) => r.key)).toEqual([
      "device_name",
      "utc_offset_min",
      "some_future_setting",
    ]);
    expect(groups).toEqual([]);
  });

  it("buckets rows into their groups, in DEVICE_SETTING_GROUPS order", () => {
    const { main, groups } = groupSettingRows(
      rowsFor("waypoint_speed", "led_brightness", "device_name", "led_day_start_hour"),
      (r) => r.key,
    );
    expect(main.map((r) => r.key)).toEqual(["device_name"]);
    expect(groups.map((g) => g.group.id)).toEqual(["leds", "advanced"]);
    expect(groups[0].rows.map((r) => r.key)).toEqual([
      "led_brightness",
      "led_day_start_hour",
    ]);
    expect(groups[1].rows.map((r) => r.key)).toEqual(["waypoint_speed"]);
  });

  // A firmware built without BIRDSEYE_ENABLE_NEOPIXEL never sends the LED keys;
  // an empty section would be a collapsible that opens onto nothing.
  it("drops a group with no rows", () => {
    const { groups } = groupSettingRows(rowsFor("device_name", "waypoint_speed"), (r) => r.key);
    expect(groups.map((g) => g.group.id)).toEqual(["advanced"]);
  });
});

// ─── the plan-0006/0007/0010 device settings ─────────────────────────────────

describe("LED strip settings", () => {
  it("accepts the full 0-255 brightness band, including the off/blank 0", () => {
    expect(validateSettingValue("led_brightness", "0")).toBeNull();
    expect(validateSettingValue("led_brightness", "255")).toBeNull();
    expect(validateSettingValue("led_brightness", "256")).toBe("Maximum value is 255");
    expect(validateSettingValue("led_brightness_night", "0")).toBeNull();
    expect(validateSettingValue("led_brightness_night", "-1")).toBe("Minimum value is 0");
  });

  it("offers the day/night start hours as 24 local-hour choices", () => {
    const def = getSettingDef("led_day_start_hour");
    expect(def?.type).toBe("enum");
    expect(def?.options).toHaveLength(24);
    expect(def?.options?.[0]).toEqual({ value: "0", label: "12:00 AM" });
    expect(def?.options?.[19]).toEqual({ value: "19", label: "7:00 PM" });
    expect(validateSettingValue("led_night_start_hour", "19")).toBeNull();
    expect(validateSettingValue("led_night_start_hour", "24")).not.toBeNull();
  });

  it("mirrors the firmware rev bands", () => {
    expect(validateSettingValue("rev_limit", "15000")).toBeNull();
    expect(validateSettingValue("rev_limit", "999")).toBe("Minimum value is 1000");
    expect(validateSettingValue("rev_limit", "20001")).toBe("Maximum value is 20000");
  });

  // overrev_limit is 0 (disabled) OR 1000-20000 — the firmware special-cases
  // the sentinel below its own floor.
  it("accepts 0 as the over-rev disable sentinel but nothing else below the floor", () => {
    expect(validateSettingValue("overrev_limit", "0")).toBeNull();
    expect(validateSettingValue("overrev_limit", "500")).toBe("Minimum value is 1000");
    expect(validateSettingValue("overrev_limit", "16000")).toBeNull();
  });

  it("mirrors the firmware temperature-alert band", () => {
    expect(validateSettingValue("temp1_alert_c", "650")).toBeNull();
    expect(validateSettingValue("temp1_alert_c", "49")).toBe("Minimum value is 50");
    expect(validateSettingValue("temp1_alert_c", "1201")).toBe("Maximum value is 1200");
  });
});

describe("utc_offset_min", () => {
  it("is a timezone field validated against the firmware's ±14 h band", () => {
    expect(getSettingDef("utc_offset_min")?.type).toBe("timezone");
    expect(validateSettingValue("utc_offset_min", "-360")).toBeNull();
    expect(validateSettingValue("utc_offset_min", "345")).toBeNull();
    expect(validateSettingValue("utc_offset_min", "0")).toBeNull();
    expect(validateSettingValue("utc_offset_min", "841")).toBe("Maximum value is 840");
    expect(validateSettingValue("utc_offset_min", "-841")).toBe("Minimum value is -840");
    expect(validateSettingValue("utc_offset_min", "-5:30")).toBe("Must be a whole number");
  });
});

describe("tach_filter", () => {
  it("accepts the three firmware modes and rejects near misses", () => {
    expect(validateSettingValue("tach_filter", "smooth")).toBeNull();
    expect(validateSettingValue("tach_filter", "legacy")).toBeNull();
    expect(validateSettingValue("tach_filter", "raw")).toBeNull();
    expect(validateSettingValue("tach_filter", "Raw")).not.toBeNull();
  });
});
