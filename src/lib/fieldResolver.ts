// Canonical field name resolver for consistent settings across different parsers

export type CanonicalFieldId = 
  | 'altitude'
  | 'satellites'
  | 'hdop'
  | 'lat_g'
  | 'lon_g'
  | 'rpm'
  | 'water_temp'
  | 'egt'
  | 'throttle'
  | 'brake';

// Maps all possible field name variations to their canonical ID
const FIELD_ALIASES: Record<CanonicalFieldId, string[]> = {
  altitude: ['Altitude (m)', 'Altitude', 'Alt'],
  satellites: ['Satellites', 'Sats', 'NumSats'],
  hdop: ['HDOP', 'Hdop'],
  lat_g: ['Lat G', 'Lat G (Native)', 'Lateral G', 'LatG'],
  lon_g: ['Lon G', 'Lon G (Native)', 'Longitudinal G', 'LonG'],
  rpm: ['RPM', 'Rpm'],
  water_temp: ['Water Temp', 'Water Temperature', 'Coolant Temp'],
  egt: ['EGT', 'Exhaust Temp'],
  throttle: ['Throttle', 'TPS', 'Throttle Position'],
  brake: ['Brake', 'Brake Pressure'],
};

// Reverse lookup: field name -> canonical ID
const nameToCanonical: Map<string, CanonicalFieldId> = new Map();
for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) {
    nameToCanonical.set(alias.toLowerCase(), canonical as CanonicalFieldId);
  }
}

/**
 * Get the canonical field ID for a given field name.
 * Returns undefined if the field doesn't have a canonical mapping.
 */
export function getCanonicalFieldId(fieldName: string): CanonicalFieldId | undefined {
  return nameToCanonical.get(fieldName.toLowerCase());
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
 * Get all aliases for a canonical field ID
 */
export function getFieldAliases(canonicalId: CanonicalFieldId): string[] {
  return FIELD_ALIASES[canonicalId] || [];
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
