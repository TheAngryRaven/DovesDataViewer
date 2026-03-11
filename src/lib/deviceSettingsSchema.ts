// Device Settings Schema
// Declarative definitions for known device settings: labels, types, and validation rules.
// Unknown keys received from the device are displayed as raw string fields (forward-compatible).

export interface DeviceSettingDef {
  key: string;
  label: string;
  type: 'string' | 'number';
  maxLength?: number;
  min?: number;
  max?: number;
  description?: string;
}

export const DEVICE_SETTINGS_SCHEMA: DeviceSettingDef[] = [
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

  return null;
}
