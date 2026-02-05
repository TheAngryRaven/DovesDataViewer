import { useState, useEffect, useCallback } from "react";
import { Kart, listKarts, saveKart, deleteKart } from "@/lib/kartStorage";

export function useKartManager() {
  const [karts, setKarts] = useState<Kart[]>([]);

  const refresh = useCallback(async () => {
    const all = await listKarts();
    setKarts(all);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addKart = useCallback(
    async (kart: Omit<Kart, "id">) => {
      const newKart: Kart = { ...kart, id: crypto.randomUUID() };
      await saveKart(newKart);
      await refresh();
    },
    [refresh],
  );

  const updateKart = useCallback(
    async (kart: Kart) => {
      await saveKart(kart);
      await refresh();
    },
    [refresh],
  );

  const removeKart = useCallback(
    async (id: string) => {
      await deleteKart(id);
      await refresh();
    },
    [refresh],
  );

  return { karts, refresh, addKart, updateKart, removeKart };
}
