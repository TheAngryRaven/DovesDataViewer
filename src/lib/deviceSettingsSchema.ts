// Device Settings Schema
// Declarative definitions for known device settings: labels, types, and validation rules.
// Unknown keys received from the device are displayed as raw string fields (forward-compatible).

/** One choice in an `enum` setting. `value` is the literal the device stores. */
export interface DeviceSettingOption {
  value: string;
  label: string;
}

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
    key: 'lap_detection_distance',
    label: 'Lap Detection Distance',
    type: 'number',
    min: 1,
    max: 50,
    description: 'Start/finish crossing threshold in meters',
  },
  {
    key: 'waypoint_detection_distance',
    label: 'Waypoint Detection Distance',
    type: 'number',
    min: 5,
    max: 100,
    description: 'Waypoint / course detector proximity zone in meters',
  },
  {
    key: 'waypoint_speed',
    label: 'Waypoint Speed',
    type: 'number',
    min: 5,
    max: 100,
    description: 'Minimum speed (MPH) to activate lap/waypoint detection',
  },
  {
    key: 'use_legacy_csv',
    label: 'Use Legacy CSV',
    type: 'number',
    min: 0,
    max: 1,
    description: 'Save as .dove instead of .dovex (0 = off, 1 = on)',
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
];

/** Look up schema definition for a key, or return null for unknown keys */
export function getSettingDef(key: string): DeviceSettingDef | null {
  return DEVICE_SETTINGS_SCHEMA.find((s) => s.key === key) ?? null;
}

/** Validate a value against its schema definition. Returns error string or null if valid. */
export function validateSettingValue(key: string, value: string): string | null {
  const def = getSettingDef(key);
  if (!def) return null; // unknown keys: no validation

  if (def.type === 'number') {
    const num = Number(value);
    if (isNaN(num) || !Number.isInteger(num)) return 'Must be a whole number';
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
