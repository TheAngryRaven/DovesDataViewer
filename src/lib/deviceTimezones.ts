// Device timezone choices — the picker behind the logger's `utc_offset_min`.
//
// The logger stores ONE number: minutes east of UTC. It ships no tzdata and,
// deliberately, no daylight-saving rules (logger plan 0010) — a sealed device
// can't be handed legislature updates, and its only consumer is the LED
// day/night brightness swap, where "7am" just has to mean the driver's 7am.
//
// The consequences shape this module:
//   * The choices are OFFSETS, not IANA zones. Place names are hints for
//     finding your offset, not a zone database.
//   * A region that observes DST appears at two offsets, tagged winter and
//     summer, because the device can't move between them on its own. That is
//     also why `localUtcOffsetMinutes()` reports the browser's offset RIGHT
//     NOW rather than the zone's standard offset.
//   * Nothing here touches logged data: DOVEX timestamps are UTC by
//     definition and stay that way.

/** ±14 h — the firmware's `local_time::kOffsetMinLimit`. */
export const MAX_UTC_OFFSET_MINUTES = 840;

/** One selectable UTC offset, with the places that use it. */
export interface UtcOffsetChoice {
  /** Minutes east of UTC. Negative is west. */
  minutes: number;
  /** Representative regions, for recognising your own offset in the list. */
  places: string;
}

/**
 * Every offset in real-world use, including the :30 and :45 ones. Ordered west
 * to east so the list reads like a map.
 */
export const UTC_OFFSET_CHOICES: UtcOffsetChoice[] = [
  { minutes: -720, places: "Baker Island, Howland Island" },
  { minutes: -660, places: "American Samoa, Niue, Midway" },
  { minutes: -600, places: "Hawaii, Tahiti, Cook Islands" },
  { minutes: -570, places: "Marquesas Islands" },
  { minutes: -540, places: "Alaska (winter), Gambier Islands" },
  { minutes: -480, places: "US Pacific (winter), Baja California" },
  { minutes: -420, places: "US Mountain (winter), Arizona, US Pacific (summer)" },
  { minutes: -360, places: "US Central (winter), Mexico City, Saskatchewan" },
  { minutes: -300, places: "US Eastern (winter), Bogota, Lima, US Central (summer)" },
  { minutes: -240, places: "Atlantic Canada (winter), Santiago, US Eastern (summer)" },
  { minutes: -210, places: "Newfoundland (winter)" },
  { minutes: -180, places: "Sao Paulo, Buenos Aires, Montevideo" },
  { minutes: -120, places: "Fernando de Noronha, South Georgia" },
  { minutes: -60, places: "Azores (winter), Cape Verde" },
  { minutes: 0, places: "UTC, UK & Ireland (winter), Iceland, Accra" },
  { minutes: 60, places: "Central Europe (winter), Lagos, UK & Ireland (summer)" },
  { minutes: 120, places: "Eastern Europe (winter), Cairo, Johannesburg, Paris (summer)" },
  { minutes: 180, places: "Moscow, Istanbul, Riyadh, Nairobi" },
  { minutes: 210, places: "Iran" },
  { minutes: 240, places: "Dubai, Baku, Samara" },
  { minutes: 270, places: "Afghanistan" },
  { minutes: 300, places: "Pakistan, Tashkent, Yekaterinburg" },
  { minutes: 330, places: "India, Sri Lanka" },
  { minutes: 345, places: "Nepal" },
  { minutes: 360, places: "Bangladesh, Almaty, Omsk" },
  { minutes: 390, places: "Myanmar, Cocos Islands" },
  { minutes: 420, places: "Bangkok, Jakarta, Ho Chi Minh City" },
  { minutes: 480, places: "China, Singapore, Perth, Manila" },
  { minutes: 525, places: "Eucla, Western Australia" },
  { minutes: 540, places: "Japan, Korea, Yakutsk" },
  { minutes: 570, places: "Northern Territory, South Australia (winter)" },
  { minutes: 600, places: "Brisbane, Sydney (winter), Vladivostok" },
  { minutes: 630, places: "Lord Howe Island (winter)" },
  { minutes: 660, places: "Solomon Islands, Noumea, Sydney (summer)" },
  { minutes: 720, places: "New Zealand (winter), Fiji, Kamchatka" },
  { minutes: 765, places: "Chatham Islands (winter)" },
  { minutes: 780, places: "Samoa, Tonga, New Zealand (summer)" },
  { minutes: 840, places: "Kiritimati, Line Islands" },
];

/** Whether an offset is inside the band the firmware accepts (±14 h). */
export function isValidUtcOffsetMinutes(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= -MAX_UTC_OFFSET_MINUTES &&
    minutes <= MAX_UTC_OFFSET_MINUTES
  );
}

/**
 * Parse a stored `utc_offset_min` value. Strict on purpose — the firmware's
 * `setting_parse::parseIntSetting` is too, and a value it would reject falls
 * back to UTC on the device, so the UI must not pretend otherwise.
 */
export function parseUtcOffsetMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return isValidUtcOffsetMinutes(minutes) ? minutes : null;
}

/** `-360` → `"UTC-06:00"`. */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/** `-360` → `"UTC-06:00 · US Central (winter), …"`; unknown offsets keep just the offset. */
export function utcOffsetLabel(minutes: number): string {
  const choice = UTC_OFFSET_CHOICES.find((c) => c.minutes === minutes);
  return choice ? `${formatUtcOffset(minutes)} · ${choice.places}` : formatUtcOffset(minutes);
}

/**
 * The browser's offset right now — DST included, which is the point: a driver
 * setting this in July wants July's offset on the device, because the device
 * will not shift on its own in November.
 */
export function localUtcOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset();
}

/** The browser's IANA zone name (`"America/Chicago"`), or null if unavailable. */
export function localTimeZoneName(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The choice list to render for a device holding `minutes`. A device can hold
 * an offset this list doesn't have — an odd zone, or a hand-edited
 * SETTINGS.json — and dropping it would silently rewrite the user's setting on
 * the next save, so it is spliced in at its proper place instead.
 */
export function offsetChoicesIncluding(minutes: number | null): UtcOffsetChoice[] {
  if (minutes === null || UTC_OFFSET_CHOICES.some((c) => c.minutes === minutes)) {
    return UTC_OFFSET_CHOICES;
  }
  return [...UTC_OFFSET_CHOICES, { minutes, places: "Current device setting" }].sort(
    (a, b) => a.minutes - b.minutes,
  );
}

/** `19, 0` → `"7:00 PM"`. Plain 12-hour, matching the rest of the settings schema. */
export function formatClock12(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * What the device's clock reads at `now` under `offsetMinutes` — the sanity
 * check for a picked offset ("does that say roughly what my watch says?").
 */
export function deviceLocalClock(now: Date, offsetMinutes: number): string {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return formatClock12(shifted.getUTCHours(), shifted.getUTCMinutes());
}

/** The 24 local-hour choices behind the LED day/night start hours. */
export function localHourOptions(): { value: string; label: string }[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour),
    label: formatClock12(hour, 0),
  }));
}
