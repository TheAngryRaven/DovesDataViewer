import { describe, it, expect } from 'vitest';
import {
  speedUnitLabel,
  formatDistance,
  formatTrackLength,
  celsiusToFahrenheit,
  formatTemperature,
  knotsToMph,
  knotsToKph,
  windSpeedUnit,
  windSpeedValue,
  formatPressure,
  formatAltitudeFt,
  isDistanceUnitChannel,
  distanceChannelValue,
  distanceChannelUnit,
  METERS_PER_FOOT,
  FEET_PER_MILE,
  FEET_PER_METER,
} from './units';

describe('speed', () => {
  it('labels the speed unit family', () => {
    expect(speedUnitLabel(false)).toBe('MPH');
    expect(speedUnitLabel(true)).toBe('KPH');
  });
});

describe('formatDistance', () => {
  it('formats metric in m below 1 km, km above', () => {
    expect(formatDistance(500, true)).toBe('500 m');
    expect(formatDistance(999, true)).toBe('999 m');
    expect(formatDistance(1000, true)).toBe('1.00 km');
    expect(formatDistance(1500, true)).toBe('1.50 km');
  });

  it('formats imperial in ft below 1 mi, mi above', () => {
    // 304.8 m = 1000 ft
    expect(formatDistance(304.8, false)).toBe('1000 ft');
    // 1 mile in meters
    expect(formatDistance(FEET_PER_MILE * METERS_PER_FOOT, false)).toBe('1.00 mi');
  });

  it('rounds metric meters and imperial feet', () => {
    expect(formatDistance(123.4, true)).toBe('123 m');
    expect(formatDistance(METERS_PER_FOOT * 50, false)).toBe('50 ft');
  });
});

describe('formatTrackLength', () => {
  it('keeps feet in imperial', () => {
    expect(formatTrackLength(2640, false)).toBe('2640 ft'); // half mile
    expect(formatTrackLength(5280, false)).toBe('1.00 mi');
  });

  it('converts feet to meters/km in metric', () => {
    expect(formatTrackLength(1000, true)).toBe('305 m'); // 1000 ft ≈ 304.8 m
    expect(formatTrackLength(5280, true)).toBe('1.61 km'); // 1 mile ≈ 1.609 km
  });
});

describe('temperature', () => {
  it('converts C to F', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(25)).toBe(77);
  });

  it('formats per family', () => {
    expect(formatTemperature(25, true)).toBe('25°C');
    expect(formatTemperature(23.45, true)).toBe('23.5°C');
    expect(formatTemperature(25, false)).toBe('77°F');
    expect(formatTemperature(0, false)).toBe('32°F');
  });
});

describe('wind', () => {
  it('converts knots', () => {
    expect(knotsToMph(10)).toBeCloseTo(11.5078, 3);
    expect(knotsToKph(10)).toBeCloseTo(18.52, 3);
  });

  it('labels and rounds wind speed per family', () => {
    expect(windSpeedUnit(false)).toBe('mph');
    expect(windSpeedUnit(true)).toBe('km/h');
    expect(windSpeedValue(10, false)).toBe(12); // 11.5 → 12
    expect(windSpeedValue(10, true)).toBe(19); // 18.5 → 19
  });
});

describe('pressure', () => {
  it('keeps inHg in imperial, converts to hPa in metric', () => {
    expect(formatPressure(29.92, false)).toBe('29.92 inHg');
    // 29.92 inHg ≈ 1013.2 hPa
    expect(formatPressure(29.92, true)).toBe('1013 hPa');
  });
});

describe('altitude', () => {
  it('keeps feet in imperial, converts to meters in metric', () => {
    expect(formatAltitudeFt(1000, false)).toBe('1,000 ft');
    expect(formatAltitudeFt(1000, true)).toBe('305 m'); // 1000 ft ≈ 304.8 m
  });

  it('formats large values with thousands separators', () => {
    expect(formatAltitudeFt(12345, false)).toBe('12,345 ft');
  });
});

describe('distance-family channels', () => {
  it('recognizes distance + altitude, not accuracy or other channels', () => {
    expect(isDistanceUnitChannel('distance')).toBe(true);
    expect(isDistanceUnitChannel('altitude')).toBe(true);
    expect(isDistanceUnitChannel('h_acc')).toBe(false);
    expect(isDistanceUnitChannel('v_acc')).toBe(false);
    expect(isDistanceUnitChannel('speed')).toBe(false);
    expect(isDistanceUnitChannel('lat_g')).toBe(false);
  });

  it('keeps meters in metric, converts to feet in imperial', () => {
    expect(distanceChannelValue(100, true)).toBe(100);
    expect(distanceChannelValue(100, false)).toBeCloseTo(100 * FEET_PER_METER, 6);
    expect(distanceChannelValue(1000, false)).toBeCloseTo(3280.84, 1);
  });

  it('labels the channel unit per family', () => {
    expect(distanceChannelUnit(true)).toBe('m');
    expect(distanceChannelUnit(false)).toBe('ft');
  });
});
