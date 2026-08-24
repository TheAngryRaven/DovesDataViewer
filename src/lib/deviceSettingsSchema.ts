// Device Settings Schema
// Declarative definitions for known device settings: labels, types, and validation rules.
// Unknown keys received from the device are displayed as raw string fields (forward-compatible).

import { localHourOptions } from './deviceTimezones';

/** One choice in an `enum` setting. `value` is the literal the device stores. */
export interface DeviceSettingOption {
  value: string;
  label: string;
}

/**
 * Collapsible section a setting can live in. Absent = the always-visible main
 * list, which is where a new setting lands unless it is deliberately filed.
 */
export type DeviceSettingGroupId = 'leds' | 'advanced';

export interface DeviceSettingGroup {
  id: DeviceSettingGroupId;
  label: string;
  description?: string;
}

/**
 * Render order for the collapsed sections, after the main list. Advanced stays
 * last — it is the "here be dragons" drawer, not a topic.
 */
export const DEVICE_SETTING_GROUPS: DeviceSettingGroup[] = [
  {
    id: 'leds',
    label: 'LED Strip',
    description:
      'Brightness, the night dimming window, and the rev/temperature alert thresholds the strip lights on',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Detection thresholds, diagnostics and legacy switches',
  },
];

export interface DeviceSettingDef {
  key: string;
  label: string;
  /**
   * `timezone` is a number underneath — minutes east of UTC — but picked from
   * a list of offsets rather than typed, so a driver never has to work out
   * that US Central is `-360`.
   */
  type: 'string' | 'number' | 'enum' | 'timezone';
  maxLength?: number;
  min?: number;
  max?: number;
  /**
   * Accept 0 as well as the `min`..`max` band. For the alert limits 0 is the
   * "disabled" sentinel, which sits below any sane threshold.
   */
  allowZero?: boolean;
  /**
   * Required for `enum`, ignored otherwise. The device stores a bare string, so
   * a free-text field lets a typo through that the firmware then silently
   * treats as the default — which reads as the setting not working at all.
   */
  options?: DeviceSettingOption[];
  description?: string;
  /**
   * Files the setting under a collapsed section of the Device Settings tab.
   * Absent = the main list: a new setting stays visible unless flagged.
   */
  group?: DeviceSettingGroupId;
}

export const DEVICE_SETTINGS_SCHEMA: DeviceSettingDef[] = [
  {
    key: 'device_name',
    label: 'Device Name',
    type: 'string',
    maxLength: 32,
    description: 'A custom name for this logger',
  },
  {
    key: 'bluetooth_name',
    label: 'Bluetooth Name',
    type: 'string',
    maxLength: 30,
    description: 'Device broadcast name visible during pairing',
  },
  {
    key: 'bluetooth_pin',
    label: 'Bluetooth PIN',
    type: 'number',
    maxLength: 4,
    min: 0,
    max: 9999,
    description: 'Pairing PIN code (4 digits)',
  },
  {
    key: 'driver_name',
    label: 'Driver Name',
    type: 'string',
    maxLength: 30,
    description: 'Logged in DOVEX session header',
  },
  {
    // Exists on the device already, but was never in this schema — so it showed
    // up as a raw text box where a typo silently reverts the logger to circuit.
    key: 'race_mode',
    label: 'Race Mode Preference',
    type: 'enum',
    options: [
      { value: 'circuit', label: 'Circuit' },
      { value: 'sprint', label: 'Sprint' },
    ],
    description:
      'Tiebreak when both a circuit and a sprint track are in range. Never overrides a single match',
  },
  {
    key: 'display_invert',
    label: 'Display Colours',
    type: 'enum',
    options: [
      { value: 'normal', label: 'Normal (white on black)' },
      { value: 'inverted', label: 'Inverted (black on white)' },
    ],
    description: "Inverting can be easier to read in direct sun. Normal is how the logger has always looked",
  },
  {
    // The ONLY setting that scales RPM (logger plan 0012). The pickup is one
    // clamp on one plug wire, so how often THAT plug fires is the whole
    // conversion; the engine's cylinder count is not a term.
    key: 'spark_mode',
    label: 'Spark Mode',
    type: 'enum',
    options: [
      { value: 'wasted', label: 'Wasted spark / 2-stroke (1 per rev)' },
      { value: 'single', label: 'Single fire / magneto (1 per 2 revs)' },
    ],
    description:
      'How often the plug on the clamped wire fires. 2-stroke and wasted-spark 4-stroke fire every revolution; a traditional distributor or magneto fires every other one. This is the only setting that scales RPM',
  },
  {
    // Descriptive since logger plan 0012 — it does NOT scale RPM. It used to,
    // which meant a V8 entered honestly as 8 read an eighth of its real crank
    // speed, and the fix at the time was to redefine the field as "cylinders
    // the pickup sees" and tell V8 owners to enter 1. Enter what the engine
    // has; the notice below says what that costs.
    key: 'cylinder_count',
    label: 'Cylinders',
    type: 'number',
    min: 1,
    max: 16,
    description:
      "The engine's actual cylinder count — enter 8 for a V8. It does not scale RPM: the pickup clamps one plug wire, so Spark Mode above does that on its own",
  },
  {
    // Minutes east of UTC. Presentation only: logged timestamps are UTC by
    // definition and stay that way — the device uses this to know what the
    // local wall clock reads, today only for the LED day/night swap.
    key: 'utc_offset_min',
    label: 'Timezone',
    type: 'timezone',
    min: -840,
    max: 840,
    description:
      'The local clock the logger keeps. Logged data stays UTC — the device has no daylight-saving rules, so pick your offset again when your clocks change',
  },

  // ── LED strip (logger plans 0006 / 0007 / 0010) ───────────────────────────
  {
    key: 'led_brightness',
    label: 'Daytime Brightness',
    type: 'number',
    min: 0,
    max: 255,
    description: 'Global brightness cap, 0-255. 0 turns the strip off and drops its 5 V rail',
    group: 'leds',
  },
  {
    key: 'led_brightness_night',
    label: 'Night Brightness',
    type: 'number',
    min: 0,
    max: 255,
    description:
      'Cap used between the night and day hours below. 0 blanks the strip but leaves it powered',
    group: 'leds',
  },
  {
    key: 'led_day_start_hour',
    label: 'Day Starts At',
    type: 'enum',
    options: localHourOptions(),
    description: 'Local hour the daytime brightness takes over. Same as the night hour = no swap',
    group: 'leds',
  },
  {
    key: 'led_night_start_hour',
    label: 'Night Starts At',
    type: 'enum',
    options: localHourOptions(),
    description: 'Local hour the night brightness takes over — set the Timezone above first',
    group: 'leds',
  },
  {
    key: 'rev_limit',
    label: 'Rev Limit (RPM)',
    type: 'number',
    min: 1000,
    max: 20000,
    description: 'Top of the LED rev scale, and where the strip starts flashing',
    group: 'leds',
  },
  {
    key: 'overrev_limit',
    label: 'Over-rev Limit (RPM)',
    type: 'number',
    min: 1000,
    max: 20000,
    allowZero: true,
    description: 'Whole strip flashes red past this. 0 disables it',
    group: 'leds',
  },
  {
    key: 'temp1_alert_c',
    label: 'Temp Alert (°C)',
    type: 'number',
    min: 50,
    max: 1200,
    description: 'EGT/temperature channel 1 alert threshold, in Celsius',
    group: 'leds',
  },

  // ── Advanced ──────────────────────────────────────────────────────────────
  {
    key: 'lap_detection_distance',
    label: 'Lap Detection Distance',
    type: 'number',
    min: 1,
    max: 50,
    description: 'Start/finish crossing threshold in meters',
    group: 'advanced',
  },
  {
    key: 'waypoint_detection_distance',
    label: 'Waypoint Detection Distance',
    type: 'number',
    min: 5,
    max: 100,
    description: 'Waypoint / course detector proximity zone in meters',
    group: 'advanced',
  },
  {
    key: 'waypoint_speed',
    label: 'Waypoint Speed',
    type: 'number',
    min: 5,
    max: 100,
    description: 'Minimum speed (MPH) to activate lap/waypoint detection',
    group: 'advanced',
  },
  {
    key: 'use_legacy_csv',
    label: 'Use Legacy CSV',
    type: 'number',
    min: 0,
    max: 1,
    description: 'Save as .dove instead of .dovex (0 = off, 1 = on)',
    group: 'advanced',
  },
  {
    key: 'tach_filter',
    label: 'RPM Filter',
    type: 'enum',
    options: [
      { value: 'smooth', label: 'Smooth (shipped filter)' },
      { value: 'legacy', label: 'Legacy (pre-4.0 filter)' },
      { value: 'raw', label: 'Raw (no filtering)' },
    ],
    description:
      'How the logger conditions the RPM trace. Smooth is the default — raw shows exactly what the pickup delivers',
    group: 'advanced',
  },
  {
    key: 'camera_serial',
    label: 'Insta360 Serial',
    type: 'string',
    maxLength: 6,
    description: 'Paired camera for auto-record. Blank = no camera',
    group: 'advanced',
  },
  {
    key: 'debug_pages',
    label: 'Debug Pages',
    type: 'enum',
    options: [
      { value: 'hide', label: 'Hidden (racing pages only)' },
      { value: 'show', label: 'Shown (GPS/RF diagnostics first)' },
    ],
    description:
      'The two diagnostic pages at the front of the race rotation. Hidden is the factory default — show them for development or tuning',
    group: 'advanced',
  },
];

/** Look up schema definition for a key, or return null for unknown keys */
export function getSettingDef(key: string): DeviceSettingDef | null {
  return DEVICE_SETTINGS_SCHEMA.find((s) => s.key === key) ?? null;
}

/**
 * The collapsed section a key belongs to, or null for the main list. Unknown
 * keys (newer firmware than this build) get null — same as an unfiled schema
 * entry — so they stay visible rather than tucked away.
 */
export function getSettingGroup(key: string): DeviceSettingGroupId | null {
  return getSettingDef(key)?.group ?? null;
}

/** Whether a setting belongs under the collapsed "Advanced" section. */
export function isAdvancedSetting(key: string): boolean {
  return getSettingGroup(key) === 'advanced';
}

/**
 * Split rows into the always-visible main list and one bucket per collapsible
 * group, preserving the caller's ordering inside each. Groups with nothing in
 * them are dropped, so a firmware without the LED keys shows no LED section.
 */
export function groupSettingRows<T>(
  rows: T[],
  keyOf: (row: T) => string,
): { main: T[]; groups: { group: DeviceSettingGroup; rows: T[] }[] } {
  const main = rows.filter((r) => getSettingGroup(keyOf(r)) === null);
  const groups = DEVICE_SETTING_GROUPS.map((group) => ({
    group,
    rows: rows.filter((r) => getSettingGroup(keyOf(r)) === group.id),
  })).filter((g) => g.rows.length > 0);
  return { main, groups };
}

/** Validate a value against its schema definition. Returns error string or null if valid. */
export function validateSettingValue(key: string, value: string): string | null {
  const def = getSettingDef(key);
  if (!def) return null; // unknown keys: no validation

  if (def.type === 'number' || def.type === 'timezone') {
    const num = Number(value);
    if (value.trim() === '' || isNaN(num) || !Number.isInteger(num)) return 'Must be a whole number';
    if (def.allowZero && num === 0) return null;
    if (def.min !== undefined && num < def.min) return `Minimum value is ${def.min}`;
    if (def.max !== undefined && num > def.max) return `Maximum value is ${def.max}`;
    if (def.maxLength !== undefined && value.length > def.maxLength) {
      return `Maximum ${def.maxLength} digits`;
    }
  }

  if (def.type === 'string') {
    if (def.maxLength !== undefined && value.length > def.maxLength) {
      return `Maximum ${def.maxLength} characters`;
    }
  }

  if (def.type === 'enum') {
    // A definition with no options can't reject anything sensibly; treat it as
    // free text rather than blocking the user out of a field entirely.
    if (!def.options || def.options.length === 0) return null;
    if (!def.options.some((o) => o.value === value)) {
      return `Must be one of: ${def.options.map((o) => o.value).join(', ')}`;
    }
  }

  return null;
}

/**
 * A non-blocking notice about the value a setting currently holds — shown
 * alongside the field, unlike `validateSettingValue`, which rejects.
 *
 * Today there is exactly one: above a single cylinder, crank RPM is INFERRED
 * from one cylinder's ignition pulses, because there is one sense wire and one
 * clamp. Between firings the reading is an assumption, and a cylinder that
 * drops out reads as a stopped engine. That is how every clamp-on inductive
 * tach behaves — known and accepted, not a fault — but a driver who sees it in
 * a trace and hasn't been told will file it as one.
 *
 * Returns null when there is nothing to say (unknown key, unparseable value,
 * or a value with no notice attached).
 */
export function settingNotice(key: string, value: string): string | null {
  if (key !== 'cylinder_count') return null;
  const num = Number(value);
  if (value.trim() === '' || !Number.isInteger(num) || num <= 1) return null;
  return `With ${num} cylinders, RPM is inferred from the ignition pulses on the one plug wire the pickup clamps. Between firings it is an estimate, and a cylinder that stops firing reads as a stopped engine — normal for any clamp-on tach.`;
}

/**
 * The label to show for a stored value.
 *
 * A device can hold a value this app doesn't know — an older or newer firmware,
 * or a hand-edited SETTINGS.json. Falling back to the raw value keeps that
 * visible instead of silently rendering it as one of the options we do know.
 */
export function settingDisplayValue(key: string, value: string): string {
  const def = getSettingDef(key);
  if (def?.type !== 'enum') return value;
  return def.options?.find((o) => o.value === value)?.label ?? value;
}
