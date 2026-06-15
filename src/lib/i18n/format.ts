/**
 * Locale-aware display formatters — thin, pure wrappers over the `Intl` APIs,
 * keyed off a BCP-47 locale string (pass `i18n.language`). Centralising them
 * here means date/number/list formatting follows the active language uniformly
 * instead of the ad-hoc `M/D/YYYY` / `toLocaleString()` calls scattered today.
 *
 * Note: units (imperial vs metric) are a *separate* axis owned by `lib/units.ts`
 * — language never swaps units, it only localises number/date rendering.
 */

/** Format an epoch-ms timestamp (or Date) as a localized date-time string. */
export function formatDateTime(
  value: number | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

/** Format an epoch-ms timestamp (or Date) as a localized date (no time). */
export function formatDate(
  value: number | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

/** Format a number with locale-aware grouping/decimal separators. */
export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format a number with a fixed number of fraction digits, using the locale's
 * decimal separator (e.g. `formatDecimal(0.34, "de", 2)` → `"0,34"`).
 */
export function formatDecimal(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Format an integer with locale-aware thousands grouping and no fraction part
 * (e.g. `formatInteger(1200, "de")` → `"1.200"`).
 */
export function formatInteger(value: number, locale: string): string {
  return formatNumber(value, locale, { maximumFractionDigits: 0 });
}

/**
 * Format a signed delta: a leading `+` on positives, the locale's `-` on
 * negatives, and no sign on zero (e.g. `+0,25` in German). Useful for gaps and
 * change indicators where the direction must read at a glance.
 */
export function formatSignedDelta(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  const formatted = formatNumber(value, locale, options);
  return value > 0 ? `+${formatted}` : formatted;
}

/** Options for {@link formatList} — mirrors `Intl.ListFormat`'s constructor
 * options without depending on the ES2021 lib typings (our `lib` is ES2020). */
export interface ListFormatLikeOptions {
  style?: "long" | "short" | "narrow";
  type?: "conjunction" | "disjunction" | "unit";
}

interface ListFormatLike {
  format(items: Iterable<string>): string;
}
type ListFormatCtor = new (locale: string, options?: ListFormatLikeOptions) => ListFormatLike;

/**
 * Join a list with the locale's conjunction ("a, b and c" / "a, b et c").
 * Falls back to a comma-join where `Intl.ListFormat` is unavailable.
 */
export function formatList(
  items: readonly string[],
  locale: string,
  options: ListFormatLikeOptions = { style: "long", type: "conjunction" },
): string {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor }).ListFormat;
  if (!ListFormat) return items.join(", ");
  return new ListFormat(locale, options).format(items);
}
