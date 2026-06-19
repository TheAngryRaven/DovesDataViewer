import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2, Car, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleType } from "@/lib/templateStorage";
import { useEngineManager } from "@/hooks/useEngineManager";
import { EngineCombobox } from "./EngineCombobox";
import { VehicleHistoryPanel } from "./VehicleHistoryPanel";

interface VehiclesTabProps {
  vehicles: Vehicle[];
  vehicleTypes: VehicleType[];
  onAdd: (vehicle: Omit<Vehicle, "id">) => Promise<void>;
  onUpdate: (vehicle: Vehicle) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const emptyForm = (defaultTypeId: string): Omit<Vehicle, "id"> => ({
  name: "",
  vehicleTypeId: defaultTypeId,
  engine: "",
  number: 0,
  weight: 0,
  weightUnit: "lb",
});

export function VehiclesTab({ vehicles, vehicleTypes, onAdd, onUpdate, onRemove }: VehiclesTabProps) {
  const { t } = useTranslation("drawer");
  const defaultTypeId = vehicleTypes[0]?.id ?? "";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm(defaultTypeId));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [historyVehicle, setHistoryVehicle] = useState<Vehicle | null>(null);

  const { engines, addEngine, importEngines, removeEngine } = useEngineManager();

  // Seed the reusable engine list from engines already saved on vehicles.
  const vehicleEngineKey = useMemo(
    () => vehicles.map(v => v.engine).filter(Boolean).join("|"),
    [vehicles],
  );
  useEffect(() => {
    const names = vehicles.map(v => v.engine).filter(Boolean);
    if (names.length) importEngines(names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleEngineKey, importEngines]);

  const usedEngineNames = useMemo(
    () => vehicles.map(v => v.engine).filter(Boolean),
    [vehicles],
  );

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm(defaultTypeId));
  }, [defaultTypeId]);

  const handleEdit = (vehicle: Vehicle) => {
    setEditingId(vehicle.id);
    setForm({
      name: vehicle.name,
      vehicleTypeId: vehicle.vehicleTypeId || defaultTypeId,
      engine: vehicle.engine,
      number: vehicle.number,
      weight: vehicle.weight,
      weightUnit: vehicle.weightUnit,
    });
  };

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim()) return;
    if (editingId) {
      await onUpdate({ id: editingId, ...form });
    } else {
      await onAdd(form);
    }
    resetForm();
  }, [editingId, form, onAdd, onUpdate, resetForm]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    await onRemove(confirmDelete);
    setConfirmDelete(null);
    if (editingId === confirmDelete) resetForm();
  }, [confirmDelete, onRemove, editingId, resetForm]);

  if (historyVehicle) {
    return (
      <VehicleHistoryPanel
        vehicle={historyVehicle}
        vehicles={vehicles}
        onBack={() => setHistoryVehicle(null)}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {confirmDelete && (
        <div className="mx-3 mt-3 mb-1 p-3 rounded-md border border-border bg-muted/60 space-y-2 shrink-0">
          <p className="text-sm text-foreground">{t("vehicles.deleteConfirm")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>{t("vehicles.cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>{t("vehicles.delete")}</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {vehicles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Car className="w-12 h-12 opacity-30" />
            <p className="text-sm font-medium text-destructive">{t("vehicles.emptyTitle")}</p>
            <p className="text-xs">{t("vehicles.emptyHint")}</p>
          </div>
        ) : (
          vehicles.map(vehicle => {
            const vt = vehicleTypes.find(vtt => vtt.id === vehicle.vehicleTypeId);
            return (
              <div
                key={vehicle.id}
                className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors ${editingId === vehicle.id ? "ring-1 ring-primary bg-primary/5" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate text-foreground">
                    #{vehicle.number} — {vehicle.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {vt?.name ?? t("vehicles.unknownType")} · {vehicle.engine} · {vehicle.weight} {vehicle.weightUnit}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100" onClick={() => setHistoryVehicle(vehicle)} title={t("vehicleHistory.openTitle")}>
                  <History className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100" onClick={() => handleEdit(vehicle)} title={t("vehicles.edit")}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive" onClick={() => setConfirmDelete(vehicle.id)} title={t("vehicles.delete")}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border p-4 space-y-3 shrink-0">
        <div className="space-y-1">
          <Label className="text-xs">{t("vehicles.vehicleType")}</Label>
          <Select value={form.vehicleTypeId} onValueChange={v => setForm(f => ({ ...f, vehicleTypeId: v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("vehicles.selectType")} /></SelectTrigger>
            <SelectContent>
              {vehicleTypes.map(vt => (
                <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("vehicles.name")}</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t("vehicles.namePlaceholder")} className="h-8 text-sm" />
          </div>
          <EngineCombobox
            value={form.engine}
            onChange={engine => setForm(f => ({ ...f, engine }))}
            engines={engines}
            onCreate={addEngine}
            onDelete={removeEngine}
            usedNames={usedEngineNames}
          />
          <div className="space-y-1">
            <Label className="text-xs">{t("vehicles.number")}</Label>
            <Input type="number" value={form.number || ""} onChange={e => setForm(f => ({ ...f, number: parseInt(e.target.value) || 0 }))} placeholder="0" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("vehicles.weight")}</Label>
            <div className="flex items-center gap-2">
              <Input type="number" step="0.01" value={form.weight || ""} onChange={e => setForm(f => ({ ...f, weight: parseFloat(e.target.value) || 0 }))} placeholder="0.00" className="h-8 text-sm flex-1" />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-xs ${form.weightUnit === "lb" ? "text-foreground font-medium" : "text-muted-foreground"}`}>lb</span>
                <Switch checked={form.weightUnit === "kg"} onCheckedChange={checked => setForm(f => ({ ...f, weightUnit: checked ? "kg" : "lb" }))} className="scale-75" />
                <span className={`text-xs ${form.weightUnit === "kg" ? "text-foreground font-medium" : "text-muted-foreground"}`}>kg</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="flex-1" size="sm" onClick={handleSubmit} disabled={!form.name.trim()}>
            {editingId ? t("vehicles.update") : t("vehicles.add")}
          </Button>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>{t("vehicles.cancel")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
