/**
 * Centralized unit conversions + display formatting.
 *
 * The app exposes three independent imperial/metric toggles in settings, one per
 * measurement family:
 *  - **speed**    (`useKph`)            — MPH ⇄ KPH
 *  - **distance** (`useMetricDistance`) — ft/mi ⇄ m/km
 *  - **weather**  (`useMetricWeather`)  — °F, mph, inHg, ft ⇄ °C, km/h, hPa, m
 *
 * Every conversion + formatter lives here so the views never reimplement a magic
 * constant. Everything is pure and React-free for direct unit testing. Each
 * family stores a canonical internal value (distance → meters, speed → both
 * mph/kph on the sample, temperature → Celsius, wind → knots, pressure → inHg,
 * altitude → feet) and converts only at display time.
 */

// ─── Conversion constants ─────────────────────────────────────────────────────
export const METERS_PER_FOOT = 0.3048;
export const FEET_PER_METER = 1 / METERS_PER_FOOT;
export const FEET_PER_MILE = 5280;
export const METERS_PER_MILE = 1609.344;
export const KPH_PER_MPH = 1.60934;
export const MPH_PER_KNOT = 1.15078;
export const KPH_PER_KNOT = 1.852;
/** hectopascals (mbar) per inch of mercury. */
export const HPA_PER_INHG = 33.8639;

// ─── Speed (useKph) ───────────────────────────────────────────────────────────

/** Unit label for the speed family. */
export function speedUnitLabel(useKph: boolean): string {
  return useKph ? 'KPH' : 'MPH';
}

// ─── Distance (useMetricDistance) ─────────────────────────────────────────────

/**
 * Format a distance given in **meters** for the distance unit family. Switches
 * to the larger unit once past a full km / mile so long sessions stay readable:
 * metric → m / km, imperial → ft / mi.
 */
export function formatDistance(meters: number, metric: boolean): string {
  if (metric) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
  }
  const feet = meters * FEET_PER_METER;
  return feet >= FEET_PER_MILE ? `${(feet / FEET_PER_MILE).toFixed(2)} mi` : `${Math.round(feet)} ft`;
}

/**
 * Format a track/course length stored in **feet** (the on-disk + device unit) for
 * the distance unit family. Imperial keeps feet (familiar for course lengths);
 * metric converts to meters.
 */
export function formatTrackLength(lengthFt: number, metric: boolean): string {
  return formatDistance(lengthFt * METERS_PER_FOOT, metric);
}

// ─── Weather (useMetricWeather) ───────────────────────────────────────────────

/** Celsius → Fahrenheit. */
export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/** Format a temperature given in **Celsius** for the weather unit family. */
export function formatTemperature(tempC: number, metric: boolean): string {
  return metric
    ? `${Math.round(tempC * 10) / 10}°C`
    : `${Math.round(celsiusToFahrenheit(tempC))}°F`;
}

/** Knots → mph. */
export function knotsToMph(kts: number): number {
  return kts * MPH_PER_KNOT;
}

/** Knots → km/h. */
export function knotsToKph(kts: number): number {
  return kts * KPH_PER_KNOT;
}

/** Unit label for wind speed in the weather family. */
export function windSpeedUnit(metric: boolean): string {
  return metric ? 'km/h' : 'mph';
}

/** Convert a wind speed in **knots** to the weather family's display value (rounded). */
export function windSpeedValue(kts: number, metric: boolean): number {
  return Math.round(metric ? knotsToKph(kts) : knotsToMph(kts));
}

/** Format a pressure given in **inHg** for the weather unit family (inHg ⇄ hPa). */
export function formatPressure(inHg: number, metric: boolean): string {
  return metric ? `${Math.round(inHg * HPA_PER_INHG)} hPa` : `${inHg} inHg`;
}

/** Format an altitude given in **feet** for the weather unit family (ft ⇄ m). */
export function formatAltitudeFt(feet: number, metric: boolean): string {
  const value = metric ? Math.round(feet * METERS_PER_FOOT) : Math.round(feet);
  return `${value.toLocaleString()} ${metric ? 'm' : 'ft'}`;
}

// ─── Distance-family telemetry channels (useMetricDistance) ───────────────────
//
// Some logged channels are stored canonically in **meters** but represent a
// length the user reads in their chosen distance unit (e.g. cumulative distance,
// GPS altitude). These follow the distance toggle. GPS accuracy (`h_acc`/`v_acc`)
// is deliberately excluded — it's a technical metric conventionally in meters.

const DISTANCE_UNIT_CHANNELS = new Set(['distance', 'altitude']);

/** Whether a canonical channel id is a meters-based distance-family channel. */
export function isDistanceUnitChannel(channelId: string): boolean {
  return DISTANCE_UNIT_CHANNELS.has(channelId);
}

/**
 * Convert a meters-based distance-channel value to the distance display unit.
 * Uses a single continuous unit per system (m or ft) — not the m↔km / ft↔mi
 * auto-switch of {@link formatDistance} — since channel values feed continuous
 * chart axes + numeric readouts that can't switch unit mid-scale.
 */
export function distanceChannelValue(meters: number, metric: boolean): number {
  return metric ? meters : meters * FEET_PER_METER;
}

/** Display unit (`m` / `ft`) for distance-family telemetry channels. */
export function distanceChannelUnit(metric: boolean): string {
  return metric ? 'm' : 'ft';
}
