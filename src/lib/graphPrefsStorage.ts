/**
 * Persist active graph selections + per-graph heights per session file in IndexedDB.
 */
import { STORE_NAMES, withReadTransaction, withWriteTransaction } from './dbUtils';
import { toChannelKey } from './channels';

interface GraphPrefsRecord {
  sessionFileName: string;
  activeGraphs: string[];
  /** Per-graph pixel height, keyed by the same series key as activeGraphs. */
  graphHeights?: Record<string, number>;
}

/** Resolved prefs returned to the UI (keys already migrated to channel ids). */
export interface GraphPrefs {
  activeGraphs: string[];
  graphHeights: Record<string, number>;
}

const STORE = STORE_NAMES.GRAPH_PREFS;

// Synthetic graph keys that are not telemetry channels and must pass through
// channel migration untouched.
function migrateGraphKey(key: string): string {
  if (key === 'speed' || key.startsWith('__')) return key;
  return toChannelKey(key);
}

/**
 * Migrate a persisted record's legacy display-name keys to canonical channel
 * ids — for both the active-graph list and the height map. Pure (no IDB) so it
 * stays unit-testable.
 */
export function migrateGraphPrefs(record: GraphPrefsRecord | undefined): GraphPrefs {
  const activeGraphs = (record?.activeGraphs ?? []).map(migrateGraphKey);
  const graphHeights: Record<string, number> = {};
  for (const [key, height] of Object.entries(record?.graphHeights ?? {})) {
    graphHeights[migrateGraphKey(key)] = height;
  }
  return { activeGraphs, graphHeights };
}

export async function saveGraphPrefs(
  sessionFileName: string,
  activeGraphs: string[],
  graphHeights: Record<string, number> = {},
): Promise<void> {
  await withWriteTransaction(STORE, (store) => {
    store.put({ sessionFileName, activeGraphs, graphHeights } satisfies GraphPrefsRecord);
  });
}

export async function loadGraphPrefs(sessionFileName: string): Promise<GraphPrefs> {
  const record = await withReadTransaction<GraphPrefsRecord | undefined>(
    STORE,
    (store) => store.get(sessionFileName),
  );
  return migrateGraphPrefs(record);
}

export async function deleteGraphPrefs(sessionFileName: string): Promise<void> {
  await withWriteTransaction(STORE, (store) => {
    store.delete(sessionFileName);
  });
}
