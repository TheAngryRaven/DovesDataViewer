import { useState, useCallback } from "react";
import { Pencil, Trash2, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleType } from "@/lib/templateStorage";

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
  const defaultTypeId = vehicleTypes[0]?.id ?? "";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm(defaultTypeId));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm(defaultTypeId));
  };

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
  }, [editingId, form, onAdd, onUpdate]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    await onRemove(confirmDelete);
    setConfirmDelete(null);
    if (editingId === confirmDelete) resetForm();
  }, [confirmDelete, onRemove, editingId]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {confirmDelete && (
        <div className="mx-3 mt-3 mb-1 p-3 rounded-md border border-border bg-muted/60 space-y-2 shrink-0">
          <p className="text-sm text-foreground">Delete this vehicle? This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>Delete</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {vehicles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Car className="w-12 h-12 opacity-30" />
            <p className="text-sm">No vehicles yet</p>
            <p className="text-xs">Add a vehicle using the form below</p>
          </div>
        ) : (
          vehicles.map(vehicle => {
            const vt = vehicleTypes.find(t => t.id === vehicle.vehicleTypeId);
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
                    {vt?.name ?? "Unknown type"} · {vehicle.engine} · {vehicle.weight} {vehicle.weightUnit}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100" onClick={() => handleEdit(vehicle)} title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive" onClick={() => setConfirmDelete(vehicle.id)} title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border p-4 space-y-3 shrink-0">
        <div className="space-y-1">
          <Label className="text-xs">Vehicle Type</Label>
          <Select value={form.vehicleTypeId} onValueChange={v => setForm(f => ({ ...f, vehicleTypeId: v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select type…" /></SelectTrigger>
            <SelectContent>
              {vehicleTypes.map(vt => (
                <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Vehicle name" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Engine</Label>
            <Input value={form.engine} onChange={e => setForm(f => ({ ...f, engine: e.target.value }))} placeholder="Engine type" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Number</Label>
            <Input type="number" value={form.number || ""} onChange={e => setForm(f => ({ ...f, number: parseInt(e.target.value) || 0 }))} placeholder="0" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Weight</Label>
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
            {editingId ? "Update Vehicle" : "Add Vehicle"}
          </Button>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
          )}
        </div>
      </div>
    </div>
  );
}
