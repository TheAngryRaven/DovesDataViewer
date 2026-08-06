import { describe, it, expect } from "vitest";
import {
  DEVICE_SETTINGS_SCHEMA,
  getSettingDef,
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
