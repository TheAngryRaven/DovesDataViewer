import { useState, useEffect, useCallback } from "react";
import {
  VehicleType, SetupTemplate, TemplateSection,
  listVehicleTypes, listTemplates, getTemplate,
  createVehicleTypeWithTemplate, deleteVehicleTypeWithTemplate,
  saveTemplate, ensureDefaults,
} from "@/lib/templateStorage";

export function useTemplateManager() {
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [templates, setTemplates] = useState<SetupTemplate[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [vts, tpls] = await Promise.all([listVehicleTypes(), listTemplates()]);
    setVehicleTypes(vts);
    setTemplates(tpls);
  }, []);

  useEffect(() => {
    ensureDefaults().then(() => refresh()).then(() => setReady(true));
  }, [refresh]);

  const addVehicleType = useCallback(async (
    name: string,
    wheelCount: 2 | 4,
    includeTires: boolean,
    sections: TemplateSection[],
  ) => {
    const result = await createVehicleTypeWithTemplate(name, wheelCount, includeTires, sections);
    await refresh();
    return result;
  }, [refresh]);

  const removeVehicleType = useCallback(async (vehicleTypeId: string, templateId: string) => {
    await deleteVehicleTypeWithTemplate(vehicleTypeId, templateId);
    await refresh();
  }, [refresh]);

  const updateTemplate = useCallback(async (template: SetupTemplate) => {
    await saveTemplate({ ...template, updatedAt: Date.now() });
    await refresh();
  }, [refresh]);

  const getTemplateForType = useCallback((vehicleTypeId: string): SetupTemplate | null => {
    const vt = vehicleTypes.find(v => v.id === vehicleTypeId);
    if (!vt) return null;
    return templates.find(t => t.id === vt.templateId) ?? null;
  }, [vehicleTypes, templates]);

  return {
    vehicleTypes, templates, ready,
    addVehicleType, removeVehicleType, updateTemplate,
    getTemplateForType, refresh,
  };
}
