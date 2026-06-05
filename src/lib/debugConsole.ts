/**
 * On-screen debug console for mobile/PWA debugging.
 *
 * Phones (especially installed PWAs) have no dev-tools console, so a silent
 * runtime error is invisible. Loading the app with `?dbg=true` (or persisting
 * the flag) tees `console.*` plus uncaught errors / promise rejections into an
 * in-page overlay (`DebugConsole.tsx`) that can be read and copied on-device.
 *
 * The flag parsing, log buffer, and argument formatting are pure + unit-tested;
 * the console/`window` patching is a thin idempotent side-effect installed once.
 */

export type DebugLevel = 'log' | 'info' | 'warn' | 'error';

export interface DebugEntry {
  id: number;
  /** epoch ms */
  time: number;
  level: DebugLevel;
  text: string;
}

/** Ring-buffer cap — old entries drop off the front so memory stays bounded. */
export const MAX_DEBUG_ENTRIES = 300;

/** localStorage key that persists an explicit `?dbg=` override across navigation. */
export const DEBUG_STORAGE_KEY = 'htt-debug';

/**
 * Pure: is the debug overlay enabled for this `location.search` + stored flag?
 * An explicit `?dbg=true|1` / `?dbg=false|0` always wins (and is what gets
 * persisted); otherwise fall back to the stored flag.
 */
export function parseDebugEnabled(search: string, stored: string | null): boolean {
  const q = new URLSearchParams(search).get('dbg');
  if (q === 'true' || q === '1') return true;
  if (q === 'false' || q === '0') return false;
  return stored === 'true';
}

/** Pure: turn a single console argument into a compact, readable string. */
export function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) {
    return arg.stack ? `${arg.name}: ${arg.message}\n${arg.stack}` : `${arg.name}: ${arg.message}`;
  }
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/** Pure: join console arguments into one log line. */
export function formatArgs(args: unknown[]): string {
  return args.map(formatArg).join(' ');
}

/** Pure: render the buffer as plain text for the copy-to-clipboard action. */
export function formatEntriesForCopy(entries: DebugEntry[]): string {
  return entries
    .map((e) => `[${new Date(e.time).toISOString()}] ${e.level.toUpperCase()} ${e.text}`)
    .join('\n');
}

type Listener = () => void;

/** In-memory ring buffer of debug entries with a tiny subscribe API. */
class DebugLogStore {
  private entries: DebugEntry[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;
  /** Stable snapshot so `useSyncExternalStore` doesn't loop on identity. */
  private snapshot: DebugEntry[] = [];

  add(level: DebugLevel, text: string): void {
    this.entries.push({ id: this.nextId++, time: Date.now(), level, text });
    if (this.entries.length > MAX_DEBUG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_DEBUG_ENTRIES);
    }
    this.snapshot = [...this.entries];
    this.emit();
  }

  clear(): void {
    this.entries = [];
    this.snapshot = [];
    this.emit();
  }

  getSnapshot = (): DebugEntry[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* a broken listener must not break logging */
      }
    }
  }
}

/** Process-wide debug log buffer (consumed by the overlay component). */
export const debugLog = new DebugLogStore();

let captureInstalled = false;

/**
 * Patch `console.*` and global error handlers to tee into the debug buffer.
 * Idempotent and side-effectful — original console behaviour is preserved.
 */
export function installDebugCapture(): void {
  if (captureInstalled || typeof window === 'undefined') return;
  captureInstalled = true;

  const levels: DebugLevel[] = ['log', 'info', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level]?.bind(console) ?? (() => undefined);
    console[level] = (...args: unknown[]) => {
      try {
        debugLog.add(level, formatArgs(args));
      } catch {
        /* never let logging throw */
      }
      original(...args);
    };
  }

  window.addEventListener('error', (e: ErrorEvent) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
    const stack = e.error instanceof Error && e.error.stack ? `\n${e.error.stack}` : '';
    debugLog.add('error', `Uncaught: ${e.message}${where}${stack}`);
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    debugLog.add('error', `Unhandled rejection: ${formatArg(e.reason)}`);
  });
}

/**
 * Resolve enablement from the live environment, persist an explicit `?dbg=`
 * override, and install capture when on. Call once at startup (before render)
 * so early errors are caught. Returns whether the overlay is enabled.
 */
export function initDebugConsole(): boolean {
  if (typeof window === 'undefined') return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(DEBUG_STORAGE_KEY);
  } catch {
    /* storage may be unavailable (private mode) */
  }
  const enabled = parseDebugEnabled(window.location.search, stored);
  try {
    const q = new URLSearchParams(window.location.search).get('dbg');
    if (q != null) localStorage.setItem(DEBUG_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore persistence failure */
  }
  if (enabled) installDebugCapture();
  return enabled;
}

/** Whether the overlay should render (URL flag or persisted flag). */
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(DEBUG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return parseDebugEnabled(window.location.search, stored);
}
