import { useState, useEffect, useCallback } from "react";
import { Engine, listEngines, saveEngine, deleteEngine } from "@/lib/engineStorage";
import { distinctEngineNames, findEngineByName, normalizeEngineName } from "@/lib/engineUtils";

export function useEngineManager() {
  const [engines, setEngines] = useState<Engine[]>([]);

  const refresh = useCallback(async () => {
    setEngines(await listEngines());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Create an engine by name (deduped, case-insensitive). Returns the engine name. */
  const addEngine = useCallback(
    async (name: string): Promise<string | null> => {
      const display = normalizeEngineName(name);
      if (!display) return null;
      const existing = findEngineByName(engines, display);
      if (existing) return existing.name;
      await saveEngine({ id: crypto.randomUUID(), name: display, createdAt: Date.now() });
      await refresh();
      return display;
    },
    [engines, refresh],
  );

  /** Ensure every supplied name exists in the list (used to seed from existing vehicles). */
  const importEngines = useCallback(
    async (names: string[]) => {
      const current = await listEngines();
      const missing = distinctEngineNames(names).filter((n) => !findEngineByName(current, n));
      if (missing.length === 0) return;
      for (const name of missing) {
        await saveEngine({ id: crypto.randomUUID(), name, createdAt: Date.now() });
      }
      await refresh();
    },
    [refresh],
  );

  const removeEngine = useCallback(
    async (id: string) => {
      await deleteEngine(id);
      await refresh();
    },
    [refresh],
  );

  return { engines, refresh, addEngine, importEngines, removeEngine };
}
