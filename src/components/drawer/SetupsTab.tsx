import { useState, useCallback, useRef, useMemo } from "react";
import { Wrench, Plus, ArrowLeft, Pencil, Trash2, Info, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { VehicleType, SetupTemplate, TemplateSection, TemplateFieldDef } from "@/lib/templateStorage";
import { TemplateCreator } from "@/components/drawer/TemplateCreator";

interface SetupsTabProps {
  vehicles: Vehicle[];
  setups: VehicleSetup[];
  vehicleTypes: VehicleType[];
  templates: SetupTemplate[];
  onAdd: (setup: Omit<VehicleSetup, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onUpdate: (setup: VehicleSetup) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onGetLatestForVehicle: (vehicleId: string) => Promise<VehicleSetup | null>;
  onAddVehicleType: (name: string, wheelCount: 2 | 4, includeTires: boolean, sections: TemplateSection[]) => Promise<any>;
  onRemoveVehicleType: (vehicleTypeId: string, templateId: string) => Promise<void>;
}

type FormMode = "list" | "new" | "edit" | "new-type";

const emptyForm = (): Omit<VehicleSetup, "id" | "createdAt" | "updatedAt"> => ({
  vehicleId: "",
  templateId: "",
  name: "",
  unitSystem: "mm",
  tireBrand: "",
  psiMode: "single",
  psiFrontLeft: null,
  psiFrontRight: null,
  psiRearLeft: null,
  psiRearRight: null,
  tireWidthMode: "halves",
  tireWidthFrontLeft: null,
  tireWidthFrontRight: null,
  tireWidthRearLeft: null,
  tireWidthRearRight: null,
  tireDiameterMode: "halves",
  tireDiameterFrontLeft: null,
  tireDiameterFrontRight: null,
  tireDiameterRearLeft: null,
  tireDiameterRearRight: null,
  customFields: {},
});

export function SetupsTab({
  vehicles, setups, vehicleTypes, templates,
  onAdd, onUpdate, onRemove, onGetLatestForVehicle,
  onAddVehicleType, onRemoveVehicleType,
}: SetupsTabProps) {
  const [mode, setMode] = useState<FormMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [preloaded, setPreloaded] = useState(false);
  const preloadSnapshot = useRef<Record<string, unknown> | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // PSI display helpers
  const [psiSingle, setPsiSingle] = useState<number | null>(null);
  const [psiFront, setPsiFront] = useState<number | null>(null);
  const [psiRear, setPsiRear] = useState<number | null>(null);
  const [widthFront, setWidthFront] = useState<number | null>(null);
  const [widthRear, setWidthRear] = useState<number | null>(null);
  const [diamFront, setDiamFront] = useState<number | null>(null);
  const [diamRear, setDiamRear] = useState<number | null>(null);

  const currentTemplate = useMemo(() => {
    if (!selectedTypeId) return null;
    const vt = vehicleTypes.find(v => v.id === selectedTypeId);
    if (!vt) return null;
    return templates.find(t => t.id === vt.templateId) ?? null;
  }, [selectedTypeId, vehicleTypes, templates]);

  const filteredVehicles = useMemo(() => {
    if (!selectedTypeId) return vehicles;
    return vehicles.filter(v => v.vehicleTypeId === selectedTypeId);
  }, [vehicles, selectedTypeId]);

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setSelectedTypeId("");
    setPreloaded(false);
    preloadSnapshot.current = null;
    setPsiSingle(null); setPsiFront(null); setPsiRear(null);
    setWidthFront(null); setWidthRear(null);
    setDiamFront(null); setDiamRear(null);
  }, []);

  const isChanged = useCallback((key: string, currentValue: unknown): boolean => {
    if (!preloaded || !preloadSnapshot.current) return false;
    return preloadSnapshot.current[key] !== currentValue;
  }, [preloaded]);

  const openNew = useCallback(() => {
    resetForm();
    setEditingId(null);
    setMode("new");
  }, [resetForm]);

  const openEdit = useCallback((setup: VehicleSetup) => {
    setEditingId(setup.id);
    // Find vehicle type
    const vehicle = vehicles.find(v => v.id === setup.vehicleId);
    setSelectedTypeId(vehicle?.vehicleTypeId ?? "");

    const psiMode = detectPsiMode(setup);
    const widthMode = detectWidthMode(setup);
    const diamMode = detectDiameterMode(setup);

    setForm({
      vehicleId: setup.vehicleId,
      templateId: setup.templateId,
      name: setup.name,
      unitSystem: setup.unitSystem || "mm",
      tireBrand: setup.tireBrand,
      psiMode,
      psiFrontLeft: setup.psiFrontLeft,
      psiFrontRight: setup.psiFrontRight,
      psiRearLeft: setup.psiRearLeft,
      psiRearRight: setup.psiRearRight,
      tireWidthMode: widthMode,
      tireWidthFrontLeft: setup.tireWidthFrontLeft,
      tireWidthFrontRight: setup.tireWidthFrontRight,
      tireWidthRearLeft: setup.tireWidthRearLeft,
      tireWidthRearRight: setup.tireWidthRearRight,
      tireDiameterMode: diamMode,
      tireDiameterFrontLeft: setup.tireDiameterFrontLeft,
      tireDiameterFrontRight: setup.tireDiameterFrontRight,
      tireDiameterRearLeft: setup.tireDiameterRearLeft,
      tireDiameterRearRight: setup.tireDiameterRearRight,
      customFields: { ...setup.customFields },
    });

    if (psiMode === "single") setPsiSingle(setup.psiFrontLeft);
    if (psiMode === "halves") { setPsiFront(setup.psiFrontLeft); setPsiRear(setup.psiRearLeft); }
    if (widthMode === "halves") { setWidthFront(setup.tireWidthFrontLeft); setWidthRear(setup.tireWidthRearLeft); }
    if (diamMode === "halves") { setDiamFront(setup.tireDiameterFrontLeft); setDiamRear(setup.tireDiameterRearLeft); }
    setPreloaded(false);
    setMode("edit");
  }, [vehicles]);

  const handleVehicleChange = useCallback(async (vehicleId: string) => {
    setForm(prev => ({ ...prev, vehicleId }));
    if (mode !== "new") return;
    const latest = await onGetLatestForVehicle(vehicleId);
    if (latest) {
      const psiMode = detectPsiMode(latest);
      const widthMode = detectWidthMode(latest);
      const diamMode = detectDiameterMode(latest);
      setForm(prev => ({
        ...prev,
        vehicleId,
        name: prev.name,
        templateId: latest.templateId,
        unitSystem: latest.unitSystem || "mm",
        tireBrand: latest.tireBrand,
        psiMode,
        psiFrontLeft: latest.psiFrontLeft,
        psiFrontRight: latest.psiFrontRight,
        psiRearLeft: latest.psiRearLeft,
        psiRearRight: latest.psiRearRight,
        tireWidthMode: widthMode,
        tireWidthFrontLeft: latest.tireWidthFrontLeft,
        tireWidthFrontRight: latest.tireWidthFrontRight,
        tireWidthRearLeft: latest.tireWidthRearLeft,
        tireWidthRearRight: latest.tireWidthRearRight,
        tireDiameterMode: diamMode,
        tireDiameterFrontLeft: latest.tireDiameterFrontLeft,
        tireDiameterFrontRight: latest.tireDiameterFrontRight,
        tireDiameterRearLeft: latest.tireDiameterRearLeft,
        tireDiameterRearRight: latest.tireDiameterRearRight,
        customFields: { ...latest.customFields },
      }));
      if (psiMode === "single") setPsiSingle(latest.psiFrontLeft);
      if (psiMode === "halves") { setPsiFront(latest.psiFrontLeft); setPsiRear(latest.psiRearLeft); }
      if (widthMode === "halves") { setWidthFront(latest.tireWidthFrontLeft); setWidthRear(latest.tireWidthRearLeft); }
      if (diamMode === "halves") { setDiamFront(latest.tireDiameterFrontLeft); setDiamRear(latest.tireDiameterRearLeft); }
      // Snapshot for change highlighting
      preloadSnapshot.current = {
        ...latest.customFields,
        tireBrand: latest.tireBrand,
        psiSingle: psiMode === "single" ? latest.psiFrontLeft : null,
        psiFront: psiMode === "halves" ? latest.psiFrontLeft : null,
        psiRear: psiMode === "halves" ? latest.psiRearLeft : null,
        psiFrontLeft: latest.psiFrontLeft, psiFrontRight: latest.psiFrontRight,
        psiRearLeft: latest.psiRearLeft, psiRearRight: latest.psiRearRight,
        widthFront: widthMode === "halves" ? latest.tireWidthFrontLeft : null,
        widthRear: widthMode === "halves" ? latest.tireWidthRearLeft : null,
        tireWidthFrontLeft: latest.tireWidthFrontLeft, tireWidthFrontRight: latest.tireWidthFrontRight,
        tireWidthRearLeft: latest.tireWidthRearLeft, tireWidthRearRight: latest.tireWidthRearRight,
        diamFront: diamMode === "halves" ? latest.tireDiameterFrontLeft : null,
        diamRear: diamMode === "halves" ? latest.tireDiameterRearLeft : null,
        tireDiameterFrontLeft: latest.tireDiameterFrontLeft, tireDiameterFrontRight: latest.tireDiameterFrontRight,
        tireDiameterRearLeft: latest.tireDiameterRearLeft, tireDiameterRearRight: latest.tireDiameterRearRight,
      };
      setPreloaded(true);
    }
  }, [mode, onGetLatestForVehicle]);

  const handleTypeChange = useCallback((typeId: string) => {
    setSelectedTypeId(typeId);
    const vt = vehicleTypes.find(v => v.id === typeId);
    const tpl = vt ? templates.find(t => t.id === vt.templateId) : null;
    if (tpl) {
      setForm(prev => ({ ...prev, templateId: tpl.id, vehicleId: "" }));
    }
  }, [vehicleTypes, templates]);

  const handleSave = useCallback(async () => {
    let finalForm = { ...form };
    if (form.psiMode === "single" && psiSingle !== null) {
      finalForm = { ...finalForm, psiFrontLeft: psiSingle, psiFrontRight: psiSingle, psiRearLeft: psiSingle, psiRearRight: psiSingle };
    } else if (form.psiMode === "halves") {
      finalForm = { ...finalForm, psiFrontLeft: psiFront, psiFrontRight: psiFront, psiRearLeft: psiRear, psiRearRight: psiRear };
    }
    if (form.tireWidthMode === "halves") {
      finalForm = { ...finalForm, tireWidthFrontLeft: widthFront, tireWidthFrontRight: widthFront, tireWidthRearLeft: widthRear, tireWidthRearRight: widthRear };
    }
    if (form.tireDiameterMode === "halves") {
      finalForm = { ...finalForm, tireDiameterFrontLeft: diamFront, tireDiameterFrontRight: diamFront, tireDiameterRearLeft: diamRear, tireDiameterRearRight: diamRear };
    }
    if (mode === "edit" && editingId) {
      const existing = setups.find(s => s.id === editingId)!;
      await onUpdate({ ...existing, ...finalForm, id: editingId });
    } else {
      await onAdd(finalForm);
    }
    resetForm();
    setMode("list");
  }, [form, psiSingle, psiFront, psiRear, widthFront, widthRear, diamFront, diamRear, mode, editingId, setups, onAdd, onUpdate, resetForm]);

  const setCustomField = useCallback((fieldId: string, value: string | number | null) => {
    setForm(prev => ({ ...prev, customFields: { ...prev.customFields, [fieldId]: value } }));
  }, []);

  const canSave = form.vehicleId && form.name.trim();

  // ── Template Creator ──
  if (mode === "new-type") {
    return (
      <TemplateCreator
        existingTemplates={templates}
        existingTypeNames={vehicleTypes.map(vt => vt.name)}
        onSave={async (name, wheelCount, includeTires, sections) => {
          await onAddVehicleType(name, wheelCount, includeTires, sections);
          setMode("list");
        }}
        onCancel={() => setMode("list")}
      />
    );
  }

  // ── List View ──
  if (mode === "list") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {setups.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 py-16">
              <Wrench className="w-12 h-12 opacity-30" />
              <p className="text-sm font-medium">No setups yet</p>
              <p className="text-xs">Use the buttons below to get started.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {setups.map(setup => {
                const vehicle = vehicles.find(v => v.id === setup.vehicleId);
                const vt = vehicle ? vehicleTypes.find(t => t.id === vehicle.vehicleTypeId) : null;
                const isDeleting = deleteConfirmId === setup.id;
                return (
                  <div key={setup.id}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{setup.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {vehicle?.name ?? "Unknown vehicle"}{vt ? ` (${vt.name})` : ""} · {new Date(setup.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => openEdit(setup)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => setDeleteConfirmId(setup.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {isDeleting && (
                      <div className="mx-3 mb-1 p-2 rounded-md bg-destructive/10 border border-destructive/30 flex items-center gap-2">
                        <span className="text-xs text-destructive flex-1">Delete this setup?</span>
                        <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={async () => { await onRemove(setup.id); setDeleteConfirmId(null); }}>Confirm</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="shrink-0 px-3 py-3 border-t border-border space-y-2">
          <Button variant="secondary" className="w-full gap-2" onClick={() => setMode("new-type")}>
            <Car className="w-4 h-4" /> New Vehicle Type
          </Button>
          <Button className="w-full gap-2" onClick={openNew}>
            <Plus className="w-4 h-4" /> Add New Setup
          </Button>
        </div>
      </div>
    );
  }

  // ── Form View ──
  const wheelCount = currentTemplate?.wheelCount ?? 4;
  const psiOptions = wheelCount === 2 ? (["single", "halves"] as const) : (["single", "halves", "quarters"] as const);
  const psiLabels = wheelCount === 2 ? ["Single", "Halves"] : ["Single", "Halves", "Quarters"];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { resetForm(); setMode("list"); }}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground flex-1">
          {mode === "edit" ? "Edit Setup" : "New Setup"}
        </h3>
        {preloaded && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Info className="w-3 h-3" /> Pre-loaded
          </span>
        )}
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Vehicle Type & Vehicle Selection */}
        <Section>
          {mode === "new" && (
            <Field label="Vehicle Type">
              <Select value={selectedTypeId} onValueChange={handleTypeChange}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select type…" /></SelectTrigger>
                <SelectContent>
                  {vehicleTypes.map(vt => (
                    <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Vehicle">
            <Select value={form.vehicleId} onValueChange={handleVehicleChange}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select vehicle…" /></SelectTrigger>
              <SelectContent>
                {filteredVehicles.map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Setup Name">
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Race Day Dry" className="h-9" />
          </Field>
        </Section>

        {/* Global Unit Toggle — only if template has measurement fields */}
        {currentTemplate && currentTemplate.sections.some(s => s.fields.some(f => f.unit === "mm" || f.unit === "in")) && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">Measurement units</span>
            <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, unitSystem: "mm" }))}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${form.unitSystem === "mm" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >mm</button>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, unitSystem: "in" }))}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${form.unitSystem === "in" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >in</button>
            </div>
          </div>
        )}

        {/* Dynamic template sections */}
        {currentTemplate?.sections.map(section => (
          <Section key={section.id} title={section.name}>
            <div className="grid grid-cols-2 gap-2">
              {section.fields.map(field => {
                const value = form.customFields[field.id] ?? (field.type === "string" ? "" : null);
                const displayUnit = (field.unit === "mm" || field.unit === "in") ? form.unitSystem : field.unit;
                return (
                  <Field
                    key={field.id}
                    label={`${field.name}${displayUnit ? ` (${displayUnit})` : ""}`}
                    changed={isChanged(field.id, value)}
                  >
                    {field.type === "number" ? (
                      <NumberInput
                        min={field.min}
                        max={field.max}
                        step={field.step ? String(field.step) : "1"}
                        className="h-9"
                        value={value ?? ""}
                        onChange={e => setCustomField(field.id, e.target.value === "" ? null : parseFloat(e.target.value))}
                      />
                    ) : (
                      <Input
                        className="h-9"
                        value={String(value ?? "")}
                        onChange={e => setCustomField(field.id, e.target.value || null)}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          </Section>
        ))}

        {/* Built-in Tire Section */}
        {currentTemplate?.includeTires && (
          <>
            <Section title="Tires">
              <Field label="Tire Brand" changed={isChanged("tireBrand", form.tireBrand)}>
                <Input className="h-9" value={form.tireBrand} onChange={e => setForm(p => ({ ...p, tireBrand: e.target.value }))} />
              </Field>
            </Section>

            <Section title="Tire PSI">
              <ModeToggle options={psiOptions} labels={psiLabels} value={form.psiMode} onChange={v => setForm(p => ({ ...p, psiMode: v }))} />
              {form.psiMode === "single" && (
                <Field label="All Tires" changed={isChanged("psiSingle", psiSingle)}>
                  <NumberInput step="0.01" className="h-9" value={psiSingle ?? ""} onChange={e => setPsiSingle(e.target.value === "" ? null : parseFloat(e.target.value))} />
                </Field>
              )}
              {form.psiMode === "halves" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Front" changed={isChanged("psiFront", psiFront)}>
                    <NumberInput step="0.01" className="h-9" value={psiFront ?? ""} onChange={e => setPsiFront(e.target.value === "" ? null : parseFloat(e.target.value))} />
                  </Field>
                  <Field label="Rear" changed={isChanged("psiRear", psiRear)}>
                    <NumberInput step="0.01" className="h-9" value={psiRear ?? ""} onChange={e => setPsiRear(e.target.value === "" ? null : parseFloat(e.target.value))} />
                  </Field>
                </div>
              )}
              {form.psiMode === "quarters" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="FL"><NumberInput step="0.01" className="h-9" value={form.psiFrontLeft ?? ""} onChange={e => setForm(p => ({ ...p, psiFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="FR"><NumberInput step="0.01" className="h-9" value={form.psiFrontRight ?? ""} onChange={e => setForm(p => ({ ...p, psiFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="RL"><NumberInput step="0.01" className="h-9" value={form.psiRearLeft ?? ""} onChange={e => setForm(p => ({ ...p, psiRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="RR"><NumberInput step="0.01" className="h-9" value={form.psiRearRight ?? ""} onChange={e => setForm(p => ({ ...p, psiRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                </div>
              )}
            </Section>

            {/* Tire Widths */}
            <Section title={`Tire Widths (${form.unitSystem})`}>
              <ModeToggle
                options={wheelCount === 2 ? (["halves"] as const) : (["halves", "quarters"] as const)}
                labels={wheelCount === 2 ? ["Halves"] : ["Halves", "Quarters"]}
                value={form.tireWidthMode}
                onChange={v => setForm(p => ({ ...p, tireWidthMode: v }))}
              />
              {form.tireWidthMode === "halves" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Front"><NumberInput step="0.01" className="h-9" value={widthFront ?? ""} onChange={e => setWidthFront(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                  <Field label="Rear"><NumberInput step="0.01" className="h-9" value={widthRear ?? ""} onChange={e => setWidthRear(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                </div>
              )}
              {form.tireWidthMode === "quarters" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="FL"><NumberInput step="0.01" className="h-9" value={form.tireWidthFrontLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="FR"><NumberInput step="0.01" className="h-9" value={form.tireWidthFrontRight ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="RL"><NumberInput step="0.01" className="h-9" value={form.tireWidthRearLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="RR"><NumberInput step="0.01" className="h-9" value={form.tireWidthRearRight ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                </div>
              )}
            </Section>

            {/* Tire Diameter */}
            <Section title={`Tire Diameter (${form.unitSystem})`}>
              <ModeToggle
                options={wheelCount === 2 ? (["halves"] as const) : (["halves", "quarters"] as const)}
                labels={wheelCount === 2 ? ["Halves"] : ["Halves", "Quarters"]}
                value={form.tireDiameterMode}
                onChange={v => setForm(p => ({ ...p, tireDiameterMode: v }))}
              />
              {form.tireDiameterMode === "halves" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Front"><NumberInput step="0.01" className="h-9" value={diamFront ?? ""} onChange={e => setDiamFront(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                  <Field label="Rear"><NumberInput step="0.01" className="h-9" value={diamRear ?? ""} onChange={e => setDiamRear(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                </div>
              )}
              {form.tireDiameterMode === "quarters" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="FL"><NumberInput step="0.01" className="h-9" value={form.tireDiameterFrontLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="FR"><NumberInput step="0.01" className="h-9" value={form.tireDiameterFrontRight ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="RL"><NumberInput step="0.01" className="h-9" value={form.tireDiameterRearLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label="RR"><NumberInput step="0.01" className="h-9" value={form.tireDiameterRearRight ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      {/* Bottom actions */}
      <div className="shrink-0 px-3 py-3 border-t border-border flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setMode("list"); }}>Cancel</Button>
        <Button className="flex-1" disabled={!canSave} onClick={handleSave}>
          {mode === "edit" ? "Update" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Helpers ──

function detectPsiMode(s: VehicleSetup): "single" | "halves" | "quarters" {
  const vals = [s.psiFrontLeft, s.psiFrontRight, s.psiRearLeft, s.psiRearRight];
  const nonNull = vals.filter(v => v !== null);
  if (nonNull.length === 0) return "single";
  if (nonNull.every(v => v === nonNull[0])) return "single";
  if (s.psiFrontLeft === s.psiFrontRight && s.psiRearLeft === s.psiRearRight) return "halves";
  return "quarters";
}

function detectWidthMode(s: VehicleSetup): "halves" | "quarters" {
  if (s.tireWidthFrontLeft === s.tireWidthFrontRight && s.tireWidthRearLeft === s.tireWidthRearRight) return "halves";
  return "quarters";
}

function detectDiameterMode(s: VehicleSetup): "halves" | "quarters" {
  if ((s.tireDiameterFrontLeft ?? null) === (s.tireDiameterFrontRight ?? null) && (s.tireDiameterRearLeft ?? null) === (s.tireDiameterRearRight ?? null)) return "halves";
  return "quarters";
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      {title && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      {children}
    </div>
  );
}

function Field({ label, changed, children }: { label: string; changed?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className={changed ? "rounded-md ring-1 ring-primary/60" : ""}>
        {children}
      </div>
    </div>
  );
}

function ModeToggle<T extends string>({
  options, labels, value, onChange,
}: {
  options: readonly T[];
  labels: string[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 bg-muted/50 rounded-md p-0.5">
      {options.map((opt, i) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            value === opt ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}
