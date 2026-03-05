import { useState, useEffect, useCallback } from "react";
import { Vehicle, listVehicles, saveVehicle, deleteVehicle } from "@/lib/vehicleStorage";

export function useVehicleManager() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const refresh = useCallback(async () => {
    const all = await listVehicles();
    setVehicles(all);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addVehicle = useCallback(
    async (vehicle: Omit<Vehicle, "id">) => {
      const newVehicle: Vehicle = { ...vehicle, id: crypto.randomUUID() };
      await saveVehicle(newVehicle);
      await refresh();
    },
    [refresh],
  );

  const updateVehicle = useCallback(
    async (vehicle: Vehicle) => {
      await saveVehicle(vehicle);
      await refresh();
    },
    [refresh],
  );

  const removeVehicle = useCallback(
    async (id: string) => {
      await deleteVehicle(id);
      await refresh();
    },
    [refresh],
  );

  return { vehicles, refresh, addVehicle, updateVehicle, removeVehicle };
}

// Backward compat
export const useKartManager = useVehicleManager;
