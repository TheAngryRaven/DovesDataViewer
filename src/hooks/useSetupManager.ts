import { useState, useEffect, useCallback } from "react";
import { KartSetup, listSetups, saveSetup, deleteSetup, getLatestSetupForKart } from "@/lib/setupStorage";

export function useSetupManager() {
  const [setups, setSetups] = useState<KartSetup[]>([]);

  const refresh = useCallback(async () => {
    const all = await listSetups();
    setSetups(all);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addSetup = useCallback(async (setup: Omit<KartSetup, "id" | "createdAt" | "updatedAt">) => {
    const now = Date.now();
    const full: KartSetup = {
      ...setup,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await saveSetup(full);
    await refresh();
  }, [refresh]);

  const updateSetup = useCallback(async (setup: KartSetup) => {
    await saveSetup({ ...setup, updatedAt: Date.now() });
    await refresh();
  }, [refresh]);

  const removeSetup = useCallback(async (id: string) => {
    await deleteSetup(id);
    await refresh();
  }, [refresh]);

  const getLatestForKart = useCallback(async (kartId: string) => {
    return getLatestSetupForKart(kartId);
  }, []);

  return { setups, addSetup, updateSetup, removeSetup, getLatestForKart };
}
