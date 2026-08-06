/**
 * "Remind me tomorrow" for the firmware update prompt.
 *
 * The check runs on every connect, so without a snooze a user who isn't ready
 * to update gets the same dialog every time they plug in — which trains them to
 * dismiss it, which is how a genuinely important update gets missed.
 *
 * Deliberately **not** in `AppSettings`: that is cloud-synced
 * (`src/plugins/cloud-sync/accountExport.ts` reads the whole settings blob), and
 * "I'll do it tomorrow" is a decision about *this browser and this logger*, not
 * something to push to every device the user owns.
 *
 * Entries are keyed by **device and version**, because the owner runs more than
 * one logger and because a new release should ask again immediately rather than
 * inherit a snooze taken against the previous one.
 */

const KEY = 'dove-firmware-remind';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
/** Enough for a large fleet; keeps a corrupt or runaway entry list bounded. */
const MAX_ENTRIES = 50;

export interface FirmwareReminder {
  /** `<device>@<version>` — see `reminderKey`. */
  id: string;
  ts: number;
}

/**
 * The snooze key for one device/version pair.
 *
 * An unknown device still gets a key rather than being skipped: on the web the
 * BLE name is all we have, and no name at all is better treated as one anonymous
 * logger than as "never snooze".
 */
export function reminderKey(
  deviceName: string | null | undefined,
  version: string | null | undefined,
): string {
  return `${deviceName || 'unknown'}@${version || 'unknown'}`;
}

/**
 * Parse the stored list, dropping anything malformed or expired. Pure, so the
 * expiry rule is testable without touching the clock.
 */
export function parseFirmwareReminders(raw: string | null, now: number): FirmwareReminder[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is FirmwareReminder => {
        if (!v || typeof v !== 'object') return false;
        const r = v as Partial<FirmwareReminder>;
        if (typeof r.id !== 'string' || !r.id) return false;
        if (typeof r.ts !== 'number' || !Number.isFinite(r.ts)) return false;
        // A future timestamp means a clock change; treat it as live rather than
        // discarding it, so moving the clock back can't un-snooze everything.
        return now - r.ts <= MAX_AGE_MS;
      })
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** True when this device/version pair was snoozed within the last 24 h. Pure. */
export function isReminderActive(
  reminders: readonly FirmwareReminder[],
  id: string,
  now: number,
): boolean {
  return reminders.some((r) => r.id === id && now - r.ts <= MAX_AGE_MS);
}

/** Defer the prompt for this device/version for 24 hours. */
export function snoozeFirmwareUpdate(
  deviceName: string | null | undefined,
  version: string | null | undefined,
): void {
  const id = reminderKey(deviceName, version);
  try {
    const now = Date.now();
    const kept = parseFirmwareReminders(localStorage.getItem(KEY), now).filter((r) => r.id !== id);
    localStorage.setItem(KEY, JSON.stringify([...kept, { id, ts: now }].slice(-MAX_ENTRIES)));
  } catch {
    /* storage unavailable — the prompt simply shows again next connect */
  }
}

/** Whether the prompt for this device/version is currently snoozed. */
export function isFirmwareUpdateSnoozed(
  deviceName: string | null | undefined,
  version: string | null | undefined,
): boolean {
  try {
    const now = Date.now();
    return isReminderActive(
      parseFirmwareReminders(localStorage.getItem(KEY), now),
      reminderKey(deviceName, version),
      now,
    );
  } catch {
    return false;
  }
}

/** Drop every snooze. Exposed for tests and for a "check now" action. */
export function clearFirmwareReminders(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
