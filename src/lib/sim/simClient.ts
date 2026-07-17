/**
 * Typed loader for the vendored BirdsEye firmware simulator
 * (`public/sim/birdseye-sim.mjs` — the REAL DovesDataLogger firmware
 * compiled to WebAssembly, pinned by construction; see plan 0010 and
 * `BirdsEye/sim/API.md` in the firmware repo for contract v1).
 *
 * The module is same-origin and precached by the service worker, so the
 * simulator works offline. Loaded lazily — only the /simulator route
 * pays for it.
 */

/** Parsed result of `getStateJson()` (API contract v1). */
export interface SimState {
  page: number;
  raceActive: boolean;
  lapCount: number;
  bestLapMs: number;
  lastLapMs: number;
  currentLapMs: number;
  gpsFix: boolean;
  sats: number;
  rpm: number;
  loggingActive: boolean;
  trackDetected: boolean;
  courseName: string;
  millis: number;
}

/** Parsed result of `getVersion()` — build provenance of the vendored wasm. */
export interface SimVersion {
  firmwareSha: string;
  buildDate: string;
  simApiVersion: number;
  dovesLapTimerSha: string;
  adafruitGfx: string;
  adafruitSh110x: string;
}

/** The simulator instance (API contract v1). */
export interface BirdsEyeSim {
  init(): void;
  /** TRUE fresh boot — re-instantiates the wasm module. Await it. */
  reset(): Promise<void>;
  /** Advance virtual time; returns loop() iterations (or -1 on fw reboot). */
  stepMillis(deltaMs: number): number;
  /** idx: 0=Left, 1=Select, 2=Right. Real firmware debounce applies. */
  buttonDown(idx: number): void;
  buttonUp(idx: number): void;
  /** JSON string per the contract schema; false on parse error. */
  injectPvt(pvtJson: string): boolean;
  setRpm(rpm: number): void;
  /** 1024-byte view; bit = buf[x + (y>>3)*128] >> (y&7) & 1. Re-take per use. */
  getFramebuffer(): Uint8Array;
  getFrameHash(): number;
  /** Boot-sequence keyframes captured during init() (virtual timestamps). */
  getBootFrames(): { tMs: number; pixels: Uint8Array }[];
  getStateJson(): SimState;
  getVersion(): SimVersion;
  resetRequested(): boolean;
  readFile(path: string): Uint8Array | null;
  listFiles(): string[];
}

export const SIM_MODULE_URL = "/sim/birdseye-sim.mjs";

let cachedFactory: ((opts?: object) => Promise<BirdsEyeSim>) | null = null;

/** Load (once) the vendored module and create a fresh sim instance. */
export async function createSim(): Promise<BirdsEyeSim> {
  if (!cachedFactory) {
    // Runtime URL import on purpose: the module is a vendored static
    // asset, not a bundled source — Vite must leave the specifier alone.
    const mod = (await import(/* @vite-ignore */ SIM_MODULE_URL)) as {
      default: (opts?: object) => Promise<BirdsEyeSim>;
    };
    cachedFactory = mod.default;
  }
  return cachedFactory();
}
