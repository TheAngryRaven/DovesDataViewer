/**
 * CustomGps — the phone's GPS source, the software analog of the physical
 * DovesDataLogger's GPS reader.
 *
 * Where the hardware logger reads NMEA off a serial GPS at a fixed rate and
 * appends records to a `.dove` file, this class drives the browser Geolocation
 * API (`watchPosition`, high-accuracy + never-cached) and emits a stream of
 * normalized `GpsFix` records (`gpsFix.ts`) wrapped as `GpsObservation`s carrying
 * the cross-fix motion (rate, derived speed/course) the API won't give us.
 *
 * Design notes:
 * - **Geolocation is injectable** (`options.geolocation`) so the class is fully
 *   unit-testable with a fake — no real device or jsdom geolocation needed.
 * - **High-accuracy, never-cached by default**: `enableHighAccuracy: true`
 *   (precise GNSS, not coarse network positioning) and `maximumAge: 0` (every
 *   fix is fresh — the OS may never return a stale cached position).
 * - **Stateful but side-effect-light**: it owns the sequence counter, the
 *   session start timestamp (t=0 origin), the rolling-rate window, and a buffer
 *   of observations. All math is delegated to the pure helpers in `gpsFix.ts`.
 * - **No lap-timing logic.** This is the capture/data layer only; turning the
 *   buffer into laps is a later, separate concern.
 */
import {
  type GpsFix,
  type GpsFixMotion,
  createGpsFix,
  deriveMotion,
  averageHz,
} from './gpsFix';

/** Tuning + dependency-injection options for a `CustomGps` source. */
export interface CustomGpsOptions {
  /** Request the precise GNSS fix rather than coarse positioning. Default true. */
  enableHighAccuracy?: boolean;
  /** Max age (ms) of an acceptable cached fix. Default 0 — never cached. */
  maximumAge?: number;
  /** Per-fix acquisition timeout (ms) before an error is surfaced. Default 30000. */
  timeout?: number;
  /** How many recent fixes the rolling `averageHz` spans. Default 20. */
  rateWindow?: number;
  /**
   * Retain every observation in `this.buffer` (exposed via `observations`).
   * Default true. Set false when the consumer keeps its own buffer (e.g. the
   * datalogger) so the source doesn't hold a second, unbounded copy — `latest`
   * and `fixCount` keep working regardless.
   */
  retainBuffer?: boolean;
  /**
   * Geolocation implementation to drive. Defaults to `navigator.geolocation`.
   * Pass a fake in tests, or `null` to force the unsupported path.
   */
  geolocation?: Geolocation | null;
}

/** Resolved options (no undefined). */
type ResolvedOptions = Required<Omit<CustomGpsOptions, 'geolocation'>>;

const DEFAULTS: ResolvedOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 30_000,
  rateWindow: 20,
  retainBuffer: true,
};

/** A normalized, surfaced geolocation error. */
export type GpsErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'position-unavailable'
  | 'timeout'
  | 'unknown';

export interface GpsError {
  code: GpsErrorCode;
  message: string;
}

/**
 * One emitted observation: the raw fix, its cross-fix motion, the elapsed time
 * since the session's first fix (the timing timebase origin), and the rolling
 * average rate at this point in the stream.
 */
export interface GpsObservation {
  fix: GpsFix;
  motion: GpsFixMotion;
  /** Milliseconds since the first fix of this capture session (t=0 origin). */
  elapsedMs: number;
  /** Rolling average rate (Hz) over the configured window; null until 2 fixes. */
  averageHz: number | null;
}

export type GpsObservationListener = (obs: GpsObservation) => void;
export type GpsErrorListener = (err: GpsError) => void;

/** Map a DOM `GeolocationPositionError.code` to our normalized error code. */
function mapErrorCode(code: number): GpsErrorCode {
  // Per the W3C spec: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
  switch (code) {
    case 1:
      return 'permission-denied';
    case 2:
      return 'position-unavailable';
    case 3:
      return 'timeout';
    default:
      return 'unknown';
  }
}

const DEFAULT_ERROR_MESSAGES: Record<GpsErrorCode, string> = {
  'unsupported': 'Geolocation is not available in this environment.',
  'permission-denied': 'Location permission was denied.',
  'position-unavailable': 'Position is currently unavailable (no GNSS fix).',
  'timeout': 'Timed out acquiring a position fix.',
  'unknown': 'An unknown geolocation error occurred.',
};

export class CustomGps {
  private readonly options: ResolvedOptions;
  private readonly geo: Geolocation | null;

  private watchId: number | null = null;
  private seq = 0;
  private count = 0;
  private startTimestamp: number | null = null;
  private prevFix: GpsFix | null = null;
  private lastObservation: GpsObservation | null = null;
  private readonly buffer: GpsObservation[] = [];
  /** Only the most recent `rateWindow` timestamps — bounded, for averageHz. */
  private readonly timestamps: number[] = [];

  private readonly fixListeners = new Set<GpsObservationListener>();
  private readonly errorListeners = new Set<GpsErrorListener>();

  constructor(options: CustomGpsOptions = {}) {
    this.options = {
      enableHighAccuracy: options.enableHighAccuracy ?? DEFAULTS.enableHighAccuracy,
      maximumAge: options.maximumAge ?? DEFAULTS.maximumAge,
      timeout: options.timeout ?? DEFAULTS.timeout,
      rateWindow: options.rateWindow ?? DEFAULTS.rateWindow,
      retainBuffer: options.retainBuffer ?? DEFAULTS.retainBuffer,
    };
    this.geo =
      options.geolocation !== undefined
        ? options.geolocation
        : typeof navigator !== 'undefined'
          ? navigator.geolocation ?? null
          : null;
  }

  /** True while a geolocation watch is active. */
  get running(): boolean {
    return this.watchId !== null;
  }

  /** Number of fixes captured this session (independent of `retainBuffer`). */
  get fixCount(): number {
    return this.count;
  }

  /** The retained observations in order (empty when `retainBuffer` is false). */
  get observations(): readonly GpsObservation[] {
    return this.buffer;
  }

  /** The most recent observation, or null before the first fix. */
  get latest(): GpsObservation | null {
    return this.lastObservation;
  }

  /** Rolling average rate (Hz) over the configured window; null until 2 fixes. */
  get averageHz(): number | null {
    return averageHz(this.timestamps, this.options.rateWindow);
  }

  /** Subscribe to fixes. Returns an unsubscribe function. */
  onFix(listener: GpsObservationListener): () => void {
    this.fixListeners.add(listener);
    return () => {
      this.fixListeners.delete(listener);
    };
  }

  /** Subscribe to errors. Returns an unsubscribe function. */
  onError(listener: GpsErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /**
   * Begin watching position. Idempotent — a second call while running is a
   * no-op. Returns false (and emits an `unsupported` error) when no geolocation
   * implementation is available.
   */
  start(): boolean {
    if (this.running) return true;
    if (!this.geo) {
      this.emitError('unsupported');
      return false;
    }
    this.watchId = this.geo.watchPosition(
      (position) => this.handlePosition(position),
      (error) => this.handleError(error),
      {
        enableHighAccuracy: this.options.enableHighAccuracy,
        maximumAge: this.options.maximumAge,
        timeout: this.options.timeout,
      },
    );
    return true;
  }

  /** Stop watching position. Idempotent. Keeps the captured buffer intact. */
  stop(): void {
    if (this.watchId !== null && this.geo) {
      this.geo.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  /**
   * Reset the captured session: clears the buffer, sequence counter, time origin
   * and rolling-rate window. Does not stop an active watch.
   */
  clear(): void {
    this.buffer.length = 0;
    this.timestamps.length = 0;
    this.seq = 0;
    this.count = 0;
    this.startTimestamp = null;
    this.prevFix = null;
    this.lastObservation = null;
  }

  private handlePosition(position: GeolocationPosition): void {
    // Ignore any callback that races in after `stop()` cleared the watch.
    if (this.watchId === null) return;

    const fix = createGpsFix(position, this.seq++);
    if (this.startTimestamp === null) this.startTimestamp = fix.timestamp;

    const motion = deriveMotion(this.prevFix, fix);
    this.timestamps.push(fix.timestamp);
    // Keep only what averageHz needs so this array can't grow unbounded.
    if (this.timestamps.length > this.options.rateWindow) this.timestamps.shift();

    const observation: GpsObservation = {
      fix,
      motion,
      elapsedMs: fix.timestamp - this.startTimestamp,
      averageHz: averageHz(this.timestamps, this.options.rateWindow),
    };
    if (this.options.retainBuffer) this.buffer.push(observation);
    this.lastObservation = observation;
    this.count++;
    this.prevFix = fix;

    // Snapshot the set so a listener that unsubscribes mid-iteration is safe.
    for (const listener of [...this.fixListeners]) listener(observation);
  }

  private handleError(error: GeolocationPositionError): void {
    const code = mapErrorCode(error.code);
    this.emitError(code, error.message);
  }

  private emitError(code: GpsErrorCode, message?: string): void {
    const err: GpsError = { code, message: message || DEFAULT_ERROR_MESSAGES[code] };
    for (const listener of [...this.errorListeners]) listener(err);
  }
}
