// Device Settings Schema
// Declarative definitions for known device settings: labels, types, and validation rules.
// Unknown keys received from the device are displayed as raw string fields (forward-compatible).

/** One choice in an `enum` setting. `value` is the literal the device stores. */
export interface DeviceSettingOption {
  value: string;
  label: string;
  /**
   * Only offer this choice when the connected device also reports this
   * settings key. Some firmware features are compiled out per channel, and a
   * mode the device cannot render should not be in its dropdown — but the
   * schema is static and the capability is per-device, so the check happens at
   * render time via `availableOptions()`.
   *
   * A value the device is ALREADY storing is never hidden (see
   * `availableOptions`): the tab has to be able to show what is actually set,
   * even if this build would not have offered it.
   */
  requiresKey?: string;
}

/**
 * The unit family a numeric setting belongs to. The name states the unit the
 * DEVICE stores, because that is the one that never changes — the display unit
 * follows the viewer's own preference and is decided at render time.
 *
 * Device settings were unit-blind before this: the firmware stores mph and
 * Celsius, and the tab showed the raw integer whatever the app's toggles said.
 */
export type DeviceSettingUnit = 'speedMph' | 'tempC';

/** The viewer's unit preferences, as the two independent axes the app has. */
export interface UnitPrefs {
  useKph: boolean;
  useMetricWeather: boolean;
}

/** Long-form help a setting can open, keyed by topic. */
export type DeviceSettingHelpTopic = 'ledStatusModes';

export interface DeviceSettingDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'enum';
  maxLength?: number;
  min?: number;
  max?: number;
  /**
   * Required for `enum`, ignored otherwise. The device stores a bare string, so
   * a free-text field lets a typo through that the firmware then silently
   * treats as the default — which reads as the setting not working at all.
   */
  options?: DeviceSettingOption[];
  description?: string;
  /**
   * `number` only. Accept a literal 0 in addition to the [min, max] band —
   * for a setting where 0 means "disabled" and the working range starts well
   * above it (`overrev_limit` is 0 OR 1000-20000). Without this the field
   * would have to advertise a range the firmware silently rejects.
   */
  zeroDisables?: boolean;
  /**
   * `number` only. The value is stored on the device in this unit and shown
   * in whichever the viewer prefers. Validation always runs in DEVICE units,
   * so the firmware's own clamp is what gets enforced.
   */
  unit?: DeviceSettingUnit;
  /** Opens a longer explainer next to the label. */
  helpTopic?: DeviceSettingHelpTopic;
  /**
   * Tucks the setting under the collapsed "Advanced" section of the Device
   * Settings tab (detection thresholds, debug toggles, legacy switches).
   * Absent = normal: a new setting shows in the main list unless flagged.
   */
  advanced?: boolean;
}

/**
 * The eight things a status LED can be assigned to. Values are the tokens the
 * firmware's `led_status::modeName()` stores; see `helpTopic: 'ledStatusModes'`
 * for the colour meanings, which are too long for a description line.
 */
export const LED_STATUS_MODE_OPTIONS: DeviceSettingOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'rpm', label: 'Target RPM' },
  { value: 'speed', label: 'Target Speed' },
  { value: 'gps', label: 'GPS Status' },
  { value: 'camera', label: 'Camera Sync' },
  { value: 'lap', label: 'Last Lap' },
  { value: 'sector', label: 'Last Sector' },
  // EGT is compiled out of a stock logger, where it renders as a dark LED.
  // temp1_alert_c ships on exactly the builds that can render it, so its
  // presence is the capability signal.
  { value: 'egt', label: 'EGT (SensorEgg)', requiresKey: 'temp1_alert_c' },
];

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
    key: 'lap_detection_distance',
    label: 'Lap Detection Distance',
    type: 'number',
    min: 1,
    max: 50,
    description: 'Start/finish crossing threshold in meters',
    advanced: true,
  },
  {
    key: 'waypoint_detection_distance',
    label: 'Waypoint Detection Distance',
    type: 'number',
    min: 5,
    max: 100,
    description: 'Waypoint / course detector proximity zone in meters',
    advanced: true,
  },
  {
    key: 'waypoint_speed',
    label: 'Waypoint Speed',
    type: 'number',
    min: 5,
    max: 100,
    description: 'Minimum speed (MPH) to activate lap/waypoint detection',
    advanced: true,
  },
  {
    key: 'use_legacy_csv',
    label: 'Use Legacy CSV',
    type: 'number',
    min: 0,
    max: 1,
    description: 'Save as .dove instead of .dovex (0 = off, 1 = on)',
    advanced: true,
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
    key: 'debug_pages',
    label: 'Debug Pages',
    type: 'enum',
    options: [
      { value: 'hide', label: 'Hidden (racing pages only)' },
      { value: 'show', label: 'Shown (GPS/RF diagnostics first)' },
    ],
    description:
      'The two diagnostic pages at the front of the race rotation. Hidden is the factory default — show them for development or tuning',
    advanced: true,
  },
  {
    key: 'spark_mode',
    label: 'Spark Mode',
    type: 'enum',
    options: [
      { value: 'wasted', label: 'Wasted spark (1 per rev)' },
      { value: 'single', label: 'Single fire (1 per 2 revs)' },
    ],
    description:
      'How often the ignition fires per revolution. 2-stroke and wasted-spark 4-stroke fire every rev',
  },
  {
    key: 'cylinder_count',
    label: 'Cylinders',
    type: 'number',
    min: 1,
    max: 16,
    description:
      'Cylinders the pickup SEES — a clamp around one plug wire of a twin sees one, so leave it at 1',
  },
  {
    key: 'camera_serial',
    label: 'Paired Camera',
    type: 'string',
    maxLength: 6,
    description:
      "The Insta360's 6-character serial, captured when you pair on the device. Clear it to unpair",
    advanced: true,
  },
  {
    key: 'tach_filter',
    label: 'RPM Filter',
    type: 'enum',
    options: [
      { value: 'smooth', label: 'Smooth (recommended)' },
      { value: 'legacy', label: 'Legacy (pre-4.0 filter)' },
      { value: 'raw', label: 'Raw (no filtering)' },
    ],
    description:
      'Diagnostic knob, not a tuning dial. Raw shows exactly what the pickup delivers — use it to tell a dirty pickup from a bad filter',
    advanced: true,
  },

  // ---- LEDs (subsystem 16) ----------------------------------------------
  {
    key: 'led_brightness',
    label: 'LED Brightness',
    type: 'number',
    min: 0,
    max: 255,
    description:
      'Global cap 0-255 — no LED ever goes brighter. 0 turns the strip off entirely and never powers its 5 V rail',
  },
  {
    key: 'led_status_left',
    label: 'Left Status LED',
    type: 'enum',
    options: LED_STATUS_MODE_OPTIONS,
    description: 'What the left status LED shows',
    helpTopic: 'ledStatusModes',
  },
  {
    key: 'led_status_right',
    label: 'Right Status LED',
    type: 'enum',
    options: LED_STATUS_MODE_OPTIONS,
    description: 'What the right status LED shows',
    helpTopic: 'ledStatusModes',
  },
  {
    key: 'target_rpm',
    label: 'Target RPM',
    type: 'number',
    min: 1000,
    max: 20000,
    description:
      'Your shift point — the top of the LED rev bar, and where a Target RPM status LED starts flashing. Not a limiter; that is Over-Rev below',
  },
  {
    // The pre-4.2 name for target_rpm. Kept so a logger on older firmware
    // still gets a labelled field instead of a raw text box — the tab only
    // renders keys the device actually reports, so exactly one of the two
    // ever appears.
    key: 'rev_limit',
    label: 'Target RPM',
    type: 'number',
    min: 1000,
    max: 20000,
    description:
      'Your shift point — the top of the LED rev bar, and the rev warning LED threshold. Renamed to Target RPM on firmware 4.2 and later',
  },
  {
    key: 'target_speed_mph',
    label: 'Target Speed',
    type: 'number',
    min: 5,
    max: 250,
    unit: 'speedMph',
    description:
      'Top of the LED bar on a session with no tachometer, and where a Target Speed status LED starts flashing',
  },
  {
    key: 'overrev_limit',
    label: 'Over-Rev Limit',
    type: 'number',
    min: 1000,
    max: 20000,
    zeroDisables: true,
    description:
      'Something is mechanically wrong above this: the whole LED strip flashes red and the tach page says OVER REV. 0 disables it',
  },
  {
    key: 'temp1_alert_c',
    label: 'EGT Alert',
    type: 'number',
    min: 50,
    max: 1200,
    unit: 'tempC',
    description:
      'An EGT status LED flashes red at or above this, and clears 20 C below it. Needs a SensorEgg probe',
  },
  {
    key: 'led_brightness_night',
    label: 'LED Brightness (Night)',
    type: 'number',
    min: 0,
    max: 255,
    description:
      'Cap used between the night and day hours below. 0 blanks the strip but leaves its power rail up — only the main brightness cuts that',
    advanced: true,
  },
  {
    key: 'led_day_start_hour',
    label: 'Day Starts (hour)',
    type: 'number',
    min: 0,
    max: 23,
    description:
      'Local hour the day brightness takes over. Set both hours the same to use one brightness around the clock',
    advanced: true,
  },
  {
    key: 'led_night_start_hour',
    label: 'Night Starts (hour)',
    type: 'number',
    min: 0,
    max: 23,
    description: 'Local hour the night brightness takes over',
    advanced: true,
  },
  {
    key: 'utc_offset_min',
    label: 'UTC Offset (minutes)',
    type: 'number',
    min: -840,
    max: 840,
    description:
      'Minutes east of UTC — US Central standard is -360, India 330. Used only to know when it is night for the LEDs; logged times stay UTC. No daylight saving',
    advanced: true,
  },
];

/** Look up schema definition for a key, or return null for unknown keys */
export function getSettingDef(key: string): DeviceSettingDef | null {
  return DEVICE_SETTINGS_SCHEMA.find((s) => s.key === key) ?? null;
}

/**
 * Whether a setting belongs under the collapsed "Advanced" section. Unknown
 * keys (newer firmware than this build) count as normal — same default as an
 * unflagged schema entry — so they stay visible rather than tucked away.
 */
export function isAdvancedSetting(key: string): boolean {
  return getSettingDef(key)?.advanced === true;
}

/** Validate a value against its schema definition. Returns error string or null if valid. */
export function validateSettingValue(key: string, value: string): string | null {
  const def = getSettingDef(key);
  if (!def) return null; // unknown keys: no validation

  if (def.type === 'number') {
    const num = Number(value);
    if (isNaN(num) || !Number.isInteger(num)) return 'Must be a whole number';
    // A "0 disables" setting has a hole in its range: the firmware accepts 0
    // or the band, and nothing between. Accepting the gap here would let the
    // user save a value the device silently throws away.
    if (!(def.zeroDisables && num === 0)) {
      if (def.min !== undefined && num < def.min) {
        return def.zeroDisables
          ? `Must be 0 (disabled) or at least ${def.min}`
          : `Minimum value is ${def.min}`;
      }
      if (def.max !== undefined && num > def.max) return `Maximum value is ${def.max}`;
    }
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

///////////////////////////////////////////
// Units
//
// The firmware stores mph and Celsius natively and has no idea what the
// viewer prefers, so conversion is purely a display concern: values come out
// of the device in device units, get shown in the viewer's, and are converted
// straight back before SSET. Validation deliberately stays in device units so
// what gets enforced is the firmware's own clamp, not a rounded copy of it.
//
// Temperature follows `useMetricWeather` and speed follows `useKph` — the app
// keeps those as two independent axes, and a device setting is not a reason to
// merge them.
///////////////////////////////////////////

const KPH_PER_MPH = 1.60934;

/**
 * Whether the viewer will see this setting in a unit other than the stored one.
 *
 * The two units sit on OPPOSITE sides of the imperial/metric line, so the two
 * tests are not the same shape: the device stores speed in mph (imperial), so
 * it converts when the viewer wants metric; it stores temperature in Celsius
 * (metric), so it converts when the viewer wants imperial.
 */
export function needsUnitConversion(unit: DeviceSettingUnit, prefs: UnitPrefs): boolean {
  return unit === 'speedMph' ? prefs.useKph : !prefs.useMetricWeather;
}

/** Unit suffix to show next to the field, e.g. "MPH" or "°F". */
export function settingUnitLabel(unit: DeviceSettingUnit, prefs: UnitPrefs): string {
  if (unit === 'speedMph') return prefs.useKph ? 'KPH' : 'MPH';
  return prefs.useMetricWeather ? '°C' : '°F';
}

/**
 * Device units -> display units. Rounds to a whole number: every unit-bearing
 * device setting is an integer, and showing 96.5604 KPH for a 60 MPH target
 * invites the user to "fix" a value that was never that precise.
 */
export function toDisplayUnits(
  unit: DeviceSettingUnit,
  deviceValue: number,
  prefs: UnitPrefs,
): number {
  if (!needsUnitConversion(unit, prefs)) return deviceValue;
  return unit === 'speedMph'
    ? Math.round(deviceValue * KPH_PER_MPH)
    : Math.round((deviceValue * 9) / 5 + 32);
}

/**
 * Display units -> device units, for the value actually written over SSET.
 *
 * Round-tripping through two roundings can move a value by one device unit
 * (enter 97 KPH, store 60 MPH, redisplay 97 — but 96 KPH also stores as 60).
 * That is inherent to storing integers in one unit and editing in another, and
 * one mph on a target speed is well under the thing's own resolution.
 */
export function fromDisplayUnits(
  unit: DeviceSettingUnit,
  displayValue: number,
  prefs: UnitPrefs,
): number {
  if (!needsUnitConversion(unit, prefs)) return displayValue;
  return unit === 'speedMph'
    ? Math.round(displayValue / KPH_PER_MPH)
    : Math.round(((displayValue - 32) * 5) / 9);
}

/**
 * The choices to offer for an enum on THIS device.
 *
 * An option can name a settings key the device must also report
 * (`requiresKey`) — that is how a firmware feature compiled out of one channel
 * stays out of its dropdown. The value the device is currently storing is
 * always kept, whatever its requirement says: hiding it would leave the select
 * unable to display the setting the user actually has.
 */
export function availableOptions(
  def: DeviceSettingDef,
  deviceKeys: ReadonlySet<string>,
  currentValue?: string,
): DeviceSettingOption[] {
  if (!def.options) return [];
  return def.options.filter(
    (o) => !o.requiresKey || deviceKeys.has(o.requiresKey) || o.value === currentValue,
  );
}
