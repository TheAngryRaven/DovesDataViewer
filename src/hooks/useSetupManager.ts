import { useState, useEffect, useCallback } from "react";
import { VehicleSetup, listSetups, saveSetup, deleteSetup, getLatestSetupForVehicle } from "@/lib/setupStorage";
import { maybePruneSetupRevisions } from "@/lib/setupRevisionStorage";

export function useSetupManager() {
  const [setups, setSetups] = useState<VehicleSetup[]>([]);

  const refresh = useCallback(async () => {
    const all = await listSetups();
    setSetups(all);
  }, []);

  useEffect(() => {
    refresh();
    // Throttled (~3-day) sweep of setup revisions no session references. Fire-
    // and-forget — never blocks the garage UI, no-ops until the interval elapses.
    void maybePruneSetupRevisions();
  }, [refresh]);

  const addSetup = useCallback(async (setup: Omit<VehicleSetup, "id" | "createdAt" | "updatedAt">) => {
    const now = Date.now();
    const full: VehicleSetup = {
      ...setup,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await saveSetup(full);
    await refresh();
  }, [refresh]);

  const updateSetup = useCallback(async (setup: VehicleSetup) => {
    await saveSetup({ ...setup, updatedAt: Date.now() });
    await refresh();
  }, [refresh]);

  const removeSetup = useCallback(async (id: string) => {
    await deleteSetup(id);
    await refresh();
  }, [refresh]);

  const getLatestForVehicle = useCallback(async (vehicleId: string) => {
    return getLatestSetupForVehicle(vehicleId);
  }, []);

  // Backward compat alias
  const getLatestForKart = getLatestForVehicle;

  return { setups, addSetup, updateSetup, removeSetup, getLatestForVehicle, getLatestForKart };
}
