/**
 * Recognising the names the on-device course creator generates.
 *
 * The logger has no text entry — deliberately, and permanently — so a course
 * walked in the field is named from the GPS clock and renamed here afterwards.
 * The firmware's format (`BirdsEye/course_creator.h`):
 *
 * - track `longName` **and** its first course name: `N{YYMMDD}_{HHMM}`, e.g.
 *   `N260803_1432`. 12 characters, so it fits the device's 13-char track
 *   browser whole.
 * - track `shortName`: `MMDDHHMM`, e.g. `08031432`. Exactly the 8 characters
 *   this app's `Track.shortName` budget allows, which is why the sync merge can
 *   key on it directly.
 *
 * Detecting these is what tells the sync flow a name is a placeholder rather
 * than something the user chose, so it knows to prompt for a real one.
 */

/** `N` + YYMMDD + `_` + HHMM. */
const GENERATED_NAME_RE = /^N(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})$/;

/** MMDDHHMM — the generated short name. */
const GENERATED_SHORT_NAME_RE = /^(\d{2})(\d{2})(\d{2})(\d{2})$/;

/** Century the two-digit year is in. The creator shipped in 2026. */
const CENTURY = 2000;

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isRealTime(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * True when a track or course name is one the device generated — i.e. a
 * placeholder the user should be asked to replace.
 *
 * The date and time parts are validated, so a genuine name that merely looks
 * like the shape (`N999999_9999`) isn't mistaken for a placeholder.
 */
export function isDeviceGeneratedName(name: string | undefined | null): boolean {
  return parseDeviceGeneratedName(name) !== null;
}

/**
 * The moment a generated name encodes, or null if it isn't one.
 *
 * Returned as a UTC `Date` because that is what the GPS clock stamped; render
 * it with UTC accessors, not local ones, or a name walked at 14:32 will display
 * as some other time.
 */
export function parseDeviceGeneratedName(name: string | undefined | null): Date | null {
  if (!name) return null;
  const m = GENERATED_NAME_RE.exec(name);
  if (!m) return null;
  const [, yy, mm, dd, hh, mi] = m;
  const year = CENTURY + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(mi);
  if (!isRealDate(year, month, day) || !isRealTime(hour, minute)) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

/**
 * True when a short name is one the device generated (`MMDDHHMM`).
 *
 * Kept separate from the long-name check because the two are independent: a
 * user can rename the track and leave the short name, or the reverse. Note this
 * carries no year, so it can only be validated as a plausible month/day/time.
 */
export function isDeviceGeneratedShortName(shortName: string | undefined | null): boolean {
  if (!shortName) return false;
  const m = GENERATED_SHORT_NAME_RE.exec(shortName);
  if (!m) return false;
  const [, mm, dd, hh, mi] = m;
  const month = Number(mm);
  const day = Number(dd);
  // No year to check against, so accept any day a month could have.
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return isRealTime(Number(hh), Number(mi));
}
