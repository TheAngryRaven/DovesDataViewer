// Core racing data types

export interface GpsSample {
  t: number; // milliseconds since start
  lat: number;
  lon: number;
  speedMps: number; // meters per second
  speedMph: number;
  speedKph: number;
  rawNmea?: string;
  extraFields: Record<string, number>;
}

export interface Track {
  id: string;
  name: string;
  startFinishA: { lat: number; lon: number };
  startFinishB: { lat: number; lon: number };
  createdAt: number;
}

export interface LapCrossing {
  sampleIndex: number;
  crossingTime: number; // ms since start
  fraction: number; // 0-1 position along segment
}

export interface Lap {
  lapNumber: number;
  startTime: number;
  endTime: number;
  lapTimeMs: number;
  maxSpeedMph: number;
  maxSpeedKph: number;
  startIndex: number;
  endIndex: number;
}

export interface FieldMapping {
  index: number;
  name: string;
  unit?: string;
  enabled: boolean;
}

export interface ParsedData {
  samples: GpsSample[];
  fieldMappings: FieldMapping[];
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  duration: number;
  startDate?: Date;
}
