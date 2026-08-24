import { describe, it, expect } from "vitest";
import {
  DEVICE_SETTINGS_SCHEMA,
  LED_STATUS_MODE_OPTIONS,
  availableOptions,
  fromDisplayUnits,
  getSettingDef,
  isAdvancedSetting,
  settingUnitLabel,
  toDisplayUnits,
  validateSettingValue,
  settingDisplayValue,
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
      expect(["string", "number", "enum"]).toContain(d.type);
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

  it("treats empty string as 0 (Number('') === 0) and applies range", () => {
    // Number("") is 0, which is an integer; for lap_detection_distance min 1 → fails
    expect(validateSettingValue("lap_detection_distance", "")).toBe(
      "Minimum value is 1"
    );
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
  });

  it("rejects zero — it would divide RPM by nothing", () => {
    expect(validateSettingValue("cylinder_count", "0")).toBe("Minimum value is 1");
  });

  it("rejects a fractional count", () => {
    expect(validateSettingValue("cylinder_count", "1.5")).toBe("Must be a whole number");
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

// ─── LED settings (firmware plan 0012) ────────────────────────────────────────

describe("led_status_left / led_status_right", () => {
  it("offer the same eight modes on both pixels", () => {
    for (const key of ["led_status_left", "led_status_right"]) {
      const def = getSettingDef(key);
      expect(def?.type).toBe("enum");
      expect(def?.options?.map((o) => o.value)).toEqual([
        "off",
        "rpm",
        "speed",
        "gps",
        "camera",
        "lap",
        "sector",
        "egt",
      ]);
    }
  });

  it("accepts every mode token the firmware stores and rejects near misses", () => {
    for (const o of LED_STATUS_MODE_OPTIONS) {
      expect(validateSettingValue("led_status_left", o.value)).toBeNull();
    }
    expect(validateSettingValue("led_status_left", "laps")).toContain("Must be one of");
    expect(validateSettingValue("led_status_left", "RPM")).toContain("Must be one of");
    expect(validateSettingValue("led_status_left", "")).toContain("Must be one of");
  });

  it("shows friendly labels for stored tokens", () => {
    expect(settingDisplayValue("led_status_left", "sector")).toBe("Last Sector");
    expect(settingDisplayValue("led_status_right", "gps")).toBe("GPS Status");
    // A token from newer firmware than this build shows verbatim.
    expect(settingDisplayValue("led_status_right", "shiftlight")).toBe("shiftlight");
  });

  it("opens the mode help from both pixels", () => {
    expect(getSettingDef("led_status_left")?.helpTopic).toBe("ledStatusModes");
    expect(getSettingDef("led_status_right")?.helpTopic).toBe("ledStatusModes");
  });
});

describe("availableOptions", () => {
  const def = getSettingDef("led_status_left")!;

  it("hides EGT on a device that reports no EGT alert setting", () => {
    // temp1_alert_c ships on exactly the firmware builds that can render the
    // EGT mode, so its absence means the mode would be a dark LED.
    const values = availableOptions(def, new Set(["led_status_left"])).map((o) => o.value);
    expect(values).not.toContain("egt");
    expect(values).toContain("lap");
  });

  it("offers EGT on a device that does report it", () => {
    const values = availableOptions(
      def,
      new Set(["led_status_left", "temp1_alert_c"]),
    ).map((o) => o.value);
    expect(values).toContain("egt");
  });

  it("never hides the value the device is currently storing", () => {
    // Otherwise the select would be unable to display the user's own setting —
    // worse than offering a mode that happens to render dark.
    const values = availableOptions(def, new Set(["led_status_left"]), "egt").map(
      (o) => o.value,
    );
    expect(values).toContain("egt");
  });

  it("leaves unrestricted options alone and returns [] for a non-enum", () => {
    const all = availableOptions(def, new Set(["temp1_alert_c"]));
    expect(all.length).toBe(LED_STATUS_MODE_OPTIONS.length);
    expect(availableOptions(getSettingDef("device_name")!, new Set())).toEqual([]);
  });
});

describe("target_rpm and the rev_limit it replaced", () => {
  it("labels both as Target RPM, so either firmware reads the same", () => {
    expect(getSettingDef("target_rpm")?.label).toBe("Target RPM");
    expect(getSettingDef("rev_limit")?.label).toBe("Target RPM");
  });

  it("clamps to the firmware's 1000-20000 band", () => {
    expect(validateSettingValue("target_rpm", "7550")).toBeNull();
    expect(validateSettingValue("target_rpm", "1000")).toBeNull();
    expect(validateSettingValue("target_rpm", "20000")).toBeNull();
    expect(validateSettingValue("target_rpm", "999")).toBe("Minimum value is 1000");
    expect(validateSettingValue("target_rpm", "20001")).toBe("Maximum value is 20000");
    // 0 is NOT a disable here — unlike overrev_limit.
    expect(validateSettingValue("target_rpm", "0")).toBe("Minimum value is 1000");
  });
});

describe("overrev_limit (zeroDisables)", () => {
  it("accepts 0 as well as the working band", () => {
    expect(validateSettingValue("overrev_limit", "0")).toBeNull();
    expect(validateSettingValue("overrev_limit", "8500")).toBeNull();
    expect(validateSettingValue("overrev_limit", "1000")).toBeNull();
    expect(validateSettingValue("overrev_limit", "20000")).toBeNull();
  });

  it("still rejects the gap between 0 and the minimum", () => {
    // The firmware accepts 0 OR 1000-20000 and silently discards anything
    // between, so accepting 500 here would look like a setting that does
    // nothing.
    expect(validateSettingValue("overrev_limit", "500")).toBe(
      "Must be 0 (disabled) or at least 1000",
    );
    expect(validateSettingValue("overrev_limit", "-1")).toBe(
      "Must be 0 (disabled) or at least 1000",
    );
    expect(validateSettingValue("overrev_limit", "20001")).toBe("Maximum value is 20000");
  });

  it("does not loosen a setting that has no zero exemption", () => {
    expect(getSettingDef("led_brightness")?.zeroDisables).toBeUndefined();
    // led_brightness's own min is 0, so 0 is legal there for a different
    // reason — the point is the flag is not set on it.
    expect(validateSettingValue("led_brightness", "0")).toBeNull();
    expect(validateSettingValue("led_brightness", "256")).toBe("Maximum value is 255");
  });
});

describe("unit-aware device settings", () => {
  const imperial = { useKph: false, useMetricWeather: false };
  const metric = { useKph: true, useMetricWeather: true };

  it("declares the unit the DEVICE stores, not the one shown", () => {
    expect(getSettingDef("target_speed_mph")?.unit).toBe("speedMph");
    expect(getSettingDef("temp1_alert_c")?.unit).toBe("tempC");
  });

  it("passes values straight through when the viewer prefers device units", () => {
    // The two units sit on opposite sides of the imperial/metric line: the
    // device stores mph (imperial) and Celsius (metric), so "no conversion"
    // means imperial for one and metric for the other.
    expect(toDisplayUnits("speedMph", 60, imperial)).toBe(60);
    expect(fromDisplayUnits("speedMph", 60, imperial)).toBe(60);
    expect(toDisplayUnits("tempC", 650, metric)).toBe(650);
    expect(fromDisplayUnits("tempC", 650, metric)).toBe(650);
  });

  it("converts speed on the useKph axis and temperature on useMetricWeather", () => {
    expect(toDisplayUnits("speedMph", 60, metric)).toBe(97);
    expect(fromDisplayUnits("speedMph", 97, metric)).toBe(60);
    expect(toDisplayUnits("tempC", 650, imperial)).toBe(1202);
    expect(fromDisplayUnits("tempC", 1202, imperial)).toBe(650);
  });

  it("keeps the two unit axes independent", () => {
    // Speed must not follow the weather toggle, nor temperature the speed one.
    const kphAndFahrenheit = { useKph: true, useMetricWeather: false };
    expect(toDisplayUnits("speedMph", 60, kphAndFahrenheit)).toBe(97);
    expect(toDisplayUnits("tempC", 650, kphAndFahrenheit)).toBe(1202);
    const mphAndCelsius = { useKph: false, useMetricWeather: true };
    expect(toDisplayUnits("speedMph", 60, mphAndCelsius)).toBe(60);
    expect(toDisplayUnits("tempC", 650, mphAndCelsius)).toBe(650);
  });

  it("labels the field with the unit actually on screen", () => {
    expect(settingUnitLabel("speedMph", imperial)).toBe("MPH");
    expect(settingUnitLabel("speedMph", metric)).toBe("KPH");
    expect(settingUnitLabel("tempC", imperial)).toBe("°F");
    expect(settingUnitLabel("tempC", metric)).toBe("°C");
  });

  it("round-trips every in-range device value to within one device unit", () => {
    // Editing integers in a converted unit cannot be exactly reversible; what
    // matters is that it never drifts further than that, so repeated opening
    // and saving of an untouched field cannot walk the value.
    for (let mph = 5; mph <= 250; mph++) {
      const back = fromDisplayUnits("speedMph", toDisplayUnits("speedMph", mph, metric), metric);
      expect(Math.abs(back - mph)).toBeLessThanOrEqual(1);
    }
    for (let c = 50; c <= 1200; c++) {
      const back = fromDisplayUnits("tempC", toDisplayUnits("tempC", c, imperial), imperial);
      expect(Math.abs(back - c)).toBeLessThanOrEqual(1);
    }
  });

  it("validates in DEVICE units, so the firmware's clamp is what is enforced", () => {
    expect(validateSettingValue("target_speed_mph", "60")).toBeNull();
    expect(validateSettingValue("target_speed_mph", "5")).toBeNull();
    expect(validateSettingValue("target_speed_mph", "250")).toBeNull();
    // 4 mph would blank the LED bar on the device; 0 especially so.
    expect(validateSettingValue("target_speed_mph", "4")).toBe("Minimum value is 5");
    expect(validateSettingValue("target_speed_mph", "0")).toBe("Minimum value is 5");
    expect(validateSettingValue("temp1_alert_c", "650")).toBeNull();
    expect(validateSettingValue("temp1_alert_c", "49")).toBe("Minimum value is 50");
    expect(validateSettingValue("temp1_alert_c", "1201")).toBe("Maximum value is 1200");
  });
});

describe("the rest of the LED settings", () => {
  it("bounds brightness, the night window and the UTC offset", () => {
    expect(validateSettingValue("led_brightness_night", "16")).toBeNull();
    expect(validateSettingValue("led_brightness_night", "256")).toBe("Maximum value is 255");
    expect(validateSettingValue("led_day_start_hour", "7")).toBeNull();
    expect(validateSettingValue("led_day_start_hour", "24")).toBe("Maximum value is 23");
    expect(validateSettingValue("led_night_start_hour", "0")).toBeNull();
    // ±14 h, the widest real offset (Chatham is +765, Baker Island −720).
    expect(validateSettingValue("utc_offset_min", "-360")).toBeNull();
    expect(validateSettingValue("utc_offset_min", "840")).toBeNull();
    expect(validateSettingValue("utc_offset_min", "-841")).toBe("Minimum value is -840");
  });

  it("keeps the day-to-day LED controls out of Advanced", () => {
    expect(isAdvancedSetting("led_brightness")).toBe(false);
    expect(isAdvancedSetting("led_status_left")).toBe(false);
    expect(isAdvancedSetting("led_status_right")).toBe(false);
    expect(isAdvancedSetting("target_rpm")).toBe(false);
    expect(isAdvancedSetting("target_speed_mph")).toBe(false);
    expect(isAdvancedSetting("overrev_limit")).toBe(false);
    expect(isAdvancedSetting("temp1_alert_c")).toBe(false);
  });

  it("tucks the set-once ones into Advanced", () => {
    expect(isAdvancedSetting("led_brightness_night")).toBe(true);
    expect(isAdvancedSetting("led_day_start_hour")).toBe(true);
    expect(isAdvancedSetting("led_night_start_hour")).toBe(true);
    expect(isAdvancedSetting("utc_offset_min")).toBe(true);
    expect(isAdvancedSetting("tach_filter")).toBe(true);
    expect(isAdvancedSetting("camera_serial")).toBe(true);
  });
});

describe("tach_filter", () => {
  it("offers the three estimator modes and rejects anything else", () => {
    for (const v of ["smooth", "legacy", "raw"]) {
      expect(validateSettingValue("tach_filter", v)).toBeNull();
    }
    expect(validateSettingValue("tach_filter", "kalman")).toBe(
      "Must be one of: smooth, legacy, raw",
    );
    expect(settingDisplayValue("tach_filter", "smooth")).toBe("Smooth (recommended)");
  });
});
