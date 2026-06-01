// Canonical field name resolver for consistent settings across different parsers.
//
// Channel identity now lives in the single registry (`channels.ts`); this module
// is the settings-facing adapter over it (canonical-id resolution + the
// settings-UI field categories). Kept as a separate module so existing imports
// (`getCanonicalFieldId`, `isFieldHiddenByCanonical`, `FIELD_CATEGORIES`) stay
// stable.

import { type ChannelId, getChannelDef, isKnownChannel, resolveChannelId } from "./channels";

/** A canonical field id is a registry channel id. */
export type CanonicalFieldId = ChannelId;

/**
 * Get the canonical field ID for a given field name (canonical label or any
 * known alias). Returns undefined if the field has no canonical mapping.
 */
export function getCanonicalFieldId(fieldName: string): CanonicalFieldId | undefined {
  // Accept an already-canonical id (post-normalization field name) or a raw
  // display name / alias (legacy callers, settings UI).
  if (isKnownChannel(fieldName)) return fieldName;
  return resolveChannelId(fieldName);
}

/**
 * Check if a field name is hidden based on the canonical hidden list.
 */
export function isFieldHiddenByCanonical(
  fieldName: string,
  hiddenCanonicalIds: string[]
): boolean {
  const canonicalId = getCanonicalFieldId(fieldName);
  if (!canonicalId) return false;
  return hiddenCanonicalIds.includes(canonicalId);
}

/**
 * Get all aliases for a canonical field ID (its label plus registered aliases).
 */
export function getFieldAliases(canonicalId: CanonicalFieldId): string[] {
  const def = getChannelDef(canonicalId);
  return def ? [def.label, ...def.aliases] : [];
}

// Field configuration for the settings UI
export interface FieldConfig {
  canonicalId: CanonicalFieldId;
  label: string;
  description: string;
}

export interface FieldCategory {
  category: string;
  description: string;
  fields: FieldConfig[];
}

export const FIELD_CATEGORIES: FieldCategory[] = [
  {
    category: "GPS Data",
    description: "Data from GPS receiver",
    fields: [
      { canonicalId: 'altitude', label: "Altitude", description: "GPS altitude in meters" },
      { canonicalId: 'satellites', label: "Satellites", description: "Number of GPS satellites" },
      { canonicalId: 'hdop', label: "HDOP", description: "Horizontal dilution of precision" },
      { canonicalId: 'h_acc', label: "H Accuracy", description: "Estimated horizontal position accuracy (m)" },
    ],
  },
  {
    category: "Computed",
    description: "Calculated from GPS data",
    fields: [
      { canonicalId: 'lat_g', label: "Lateral G", description: "Lateral acceleration (computed)" },
      { canonicalId: 'lon_g', label: "Longitudinal G", description: "Longitudinal acceleration (computed)" },
    ],
  },
  {
    category: "Motion (IMU)",
    description: "Raw accelerometer data from the device's IMU",
    fields: [
      { canonicalId: 'accel_x', label: "Accel X", description: "Raw IMU acceleration, X axis" },
      { canonicalId: 'accel_y', label: "Accel Y", description: "Raw IMU acceleration, Y axis" },
      { canonicalId: 'accel_z', label: "Accel Z", description: "Raw IMU acceleration, Z axis" },
    ],
  },
  {
    category: "Sensors",
    description: "External sensor data",
    fields: [
      { canonicalId: 'rpm', label: "RPM", description: "Engine revolutions per minute" },
      { canonicalId: 'water_temp', label: "Water Temp", description: "Coolant temperature" },
      { canonicalId: 'egt', label: "EGT", description: "Exhaust gas temperature" },
      { canonicalId: 'throttle', label: "Throttle", description: "Throttle position" },
      { canonicalId: 'brake', label: "Brake", description: "Brake pressure/position" },
    ],
  },
];
