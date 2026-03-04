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
