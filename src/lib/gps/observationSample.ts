/**
 * Bridge from a captured `GpsObservation` (the phone GPS source) to the core
 * `GpsSample` the analysis + timing code consumes. Keeps the capture layer
 * decoupled from `types/racing` — only this adapter knows both shapes.
 */
import type { GpsSample } from '@/types/racing';
import { speedTriple } from '@/lib/parserUtils';
import type { GpsObservation } from './customGps';

/**
 * Convert one observation to a `GpsSample`. `t` is the elapsed ms from the
 * capture session's first fix (already carried on the observation), so a buffer
 * of these is directly consumable by `calculateLaps` / the delta engine. Speed
 * uses the resolved best value (0 when unknown); heading uses the best course.
 * Horizontal accuracy and altitude ride along as canonical `extraFields`.
 */
export function observationToSample(obs: GpsObservation): GpsSample {
  const mps = obs.motion.speedMps ?? 0;
  const extraFields: Record<string, number> = { h_acc: obs.fix.accuracy };
  if (obs.fix.altitude != null) extraFields.altitude = obs.fix.altitude;
  if (obs.fix.altitudeAccuracy != null) extraFields.v_acc = obs.fix.altitudeAccuracy;
  return {
    t: obs.elapsedMs,
    lat: obs.fix.lat,
    lon: obs.fix.lon,
    ...speedTriple(mps),
    heading: obs.motion.course ?? undefined,
    extraFields,
  };
}
