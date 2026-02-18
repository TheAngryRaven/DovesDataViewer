/**
 * Persist active graph selections per session file in IndexedDB.
 */
import { STORE_NAMES, withReadTransaction, withWriteTransaction } from './dbUtils';

interface GraphPrefsRecord {
  sessionFileName: string;
  activeGraphs: string[];
}

const STORE = STORE_NAMES.GRAPH_PREFS;

export async function saveGraphPrefs(sessionFileName: string, activeGraphs: string[]): Promise<void> {
  await withWriteTransaction(STORE, (store) => {
    store.put({ sessionFileName, activeGraphs } satisfies GraphPrefsRecord);
  });
}

export async function loadGraphPrefs(sessionFileName: string): Promise<string[]> {
  const record = await withReadTransaction<GraphPrefsRecord | undefined>(
    STORE,
    (store) => store.get(sessionFileName),
  );
  return record?.activeGraphs ?? [];
}

export async function deleteGraphPrefs(sessionFileName: string): Promise<void> {
  await withWriteTransaction(STORE, (store) => {
    store.delete(sessionFileName);
  });
}
