import { useState, useEffect, useCallback } from "react";
import { VehicleSetup, listSetups, saveSetup, deleteSetup, getLatestSetupForVehicle } from "@/lib/setupStorage";
import { freezeSetupRevision, pruneSetupRevisionsSafely } from "@/lib/setupRevisionStorage";

export function useSetupManager() {
  const [setups, setSetups] = useState<VehicleSetup[]>([]);

  const refresh = useCallback(async () => {
    const all = await listSetups();
    setSetups(all);
  }, []);

  useEffect(() => {
    refresh();
    // Retention sweep of untagged setup revisions (plan 0028). Fire-and-forget —
    // three IndexedDB reads, never blocks the garage UI.
    void pruneSetupRevisionsSafely();
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
    // Every save freezes a content-addressed revision so the day's edits can be
    // scrubbed through even when no session was tagged (plan 0028). Untagged
    // revisions stay local and age out after REVISION_RETENTION_MS.
    await freezeSetupRevision(full.id);
    await refresh();
  }, [refresh]);

  const updateSetup = useCallback(async (setup: VehicleSetup) => {
    await saveSetup({ ...setup, updatedAt: Date.now() });
    await freezeSetupRevision(setup.id);
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
