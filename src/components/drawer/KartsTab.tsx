import { useState, useCallback } from "react";
import { Pencil, Trash2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Kart } from "@/lib/kartStorage";

interface KartsTabProps {
  karts: Kart[];
  onAdd: (kart: Omit<Kart, "id">) => Promise<void>;
  onUpdate: (kart: Kart) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const emptyForm: Omit<Kart, "id"> = { name: "", engine: "", number: 0, weight: 0, weightUnit: "lb" };

export function KartsTab({ karts, onAdd, onUpdate, onRemove }: KartsTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleEdit = (kart: Kart) => {
    setEditingId(kart.id);
    setForm({
      name: kart.name,
      engine: kart.engine,
      number: kart.number,
      weight: kart.weight,
      weightUnit: kart.weightUnit,
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
      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="mx-3 mt-3 mb-1 p-3 rounded-md border border-border bg-muted/60 space-y-2 shrink-0">
          <p className="text-sm text-foreground">
            Delete this kart? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>Delete</Button>
          </div>
        </div>
      )}

      {/* Kart List - top half */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {karts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <ShoppingCart className="w-12 h-12 opacity-30" />
            <p className="text-sm">No karts yet</p>
            <p className="text-xs">Add a kart using the form below</p>
          </div>
        ) : (
          karts.map((kart) => (
            <div
              key={kart.id}
              className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors ${editingId === kart.id ? "ring-1 ring-primary bg-primary/5" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate text-foreground">
                  #{kart.number} — {kart.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {kart.engine} · {kart.weight} {kart.weightUnit}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
                onClick={() => handleEdit(kart)}
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive"
                onClick={() => setConfirmDelete(kart.id)}
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Form - bottom half */}
      <div className="border-t border-border p-4 space-y-3 shrink-0">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Kart name"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Engine</Label>
            <Input
              value={form.engine}
              onChange={(e) => setForm((f) => ({ ...f, engine: e.target.value }))}
              placeholder="Engine type"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Number</Label>
            <Input
              type="number"
              value={form.number || ""}
              onChange={(e) => setForm((f) => ({ ...f, number: parseInt(e.target.value) || 0 }))}
              placeholder="0"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Weight</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                value={form.weight || ""}
                onChange={(e) => setForm((f) => ({ ...f, weight: parseFloat(e.target.value) || 0 }))}
                placeholder="0.00"
                className="h-8 text-sm flex-1"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-xs ${form.weightUnit === "lb" ? "text-foreground font-medium" : "text-muted-foreground"}`}>lb</span>
                <Switch
                  checked={form.weightUnit === "kg"}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, weightUnit: checked ? "kg" : "lb" }))}
                  className="scale-75"
                />
                <span className={`text-xs ${form.weightUnit === "kg" ? "text-foreground font-medium" : "text-muted-foreground"}`}>kg</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button className="flex-1" size="sm" onClick={handleSubmit} disabled={!form.name.trim()}>
            {editingId ? "Update Kart" : "Add Kart"}
          </Button>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
