/**
 * Pure helpers for the reusable engine-type list.
 * Kept free of IndexedDB so the search / dedup / create-offer logic stays
 * unit-testable and can be shared by the storage hook and the combobox UI.
 */

import type { Engine } from "./engineStorage";

/** Trimmed display form of a typed engine name. */
export function normalizeEngineName(name: string): string {
  return name.trim();
}

/** Case-insensitive comparison key for an engine name. */
export function engineNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Find a saved engine matching a name (case-insensitive, trimmed). */
export function findEngineByName(engines: Engine[], name: string): Engine | undefined {
  const key = engineNameKey(name);
  if (!key) return undefined;
  return engines.find((e) => engineNameKey(e.name) === key);
}

/** Filter the saved list by a query (case-insensitive substring; empty → all), sorted by name. */
export function filterEngines(engines: Engine[], query: string): Engine[] {
  const q = engineNameKey(query);
  const matches = q ? engines.filter((e) => engineNameKey(e.name).includes(q)) : engines.slice();
  return matches.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether to offer "create" for the typed query (non-empty and not an exact saved match). */
export function shouldOfferCreate(query: string, engines: Engine[]): boolean {
  const name = normalizeEngineName(query);
  if (!name) return false;
  return !findEngineByName(engines, name);
}

/** Distinct, trimmed, non-empty engine names from raw values (first-seen casing wins). */
export function distinctEngineNames(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const name = normalizeEngineName(raw ?? "");
    if (!name) continue;
    const key = engineNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
