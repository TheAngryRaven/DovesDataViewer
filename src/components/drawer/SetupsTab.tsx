import { useState, useCallback, useRef } from "react";
import { Wrench, Plus, ArrowLeft, Pencil, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Kart } from "@/lib/kartStorage";
import { KartSetup } from "@/lib/setupStorage";

interface SetupsTabProps {
  karts: Kart[];
  setups: KartSetup[];
  onAdd: (setup: Omit<KartSetup, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onUpdate: (setup: KartSetup) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onGetLatestForKart: (kartId: string) => Promise<KartSetup | null>;
}

type FormMode = "list" | "new" | "edit";

const emptyForm = (): Omit<KartSetup, "id" | "createdAt" | "updatedAt"> => ({
  kartId: "",
  name: "",
  toe: null,
  camber: null,
  castor: null,
  frontWidth: null,
  frontWidthUnit: "mm",
  rearWidth: null,
  rearWidthUnit: "mm",
  rearHeight: null,
  rearHeightUnit: "mm",
  frontSprocket: null,
  rearSprocket: null,
  steeringBrand: "",
  steeringSetting: null,
  spindleSetting: null,
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
  tireWidthUnit: "mm",
  tireDiameterMode: "halves",
  tireDiameterFrontLeft: null,
  tireDiameterFrontRight: null,
  tireDiameterRearLeft: null,
  tireDiameterRearRight: null,
  tireDiameterUnit: "mm",
});

function detectPsiMode(s: KartSetup): "single" | "halves" | "quarters" {
  const vals = [s.psiFrontLeft, s.psiFrontRight, s.psiRearLeft, s.psiRearRight];
  const nonNull = vals.filter((v) => v !== null);
  if (nonNull.length === 0) return "single";
  if (nonNull.every((v) => v === nonNull[0])) return "single";
  if (s.psiFrontLeft === s.psiFrontRight && s.psiRearLeft === s.psiRearRight) return "halves";
  return "quarters";
}

function detectWidthMode(s: KartSetup): "halves" | "quarters" {
  if (s.tireWidthFrontLeft === s.tireWidthFrontRight && s.tireWidthRearLeft === s.tireWidthRearRight) return "halves";
  return "quarters";
}

function detectDiameterMode(s: KartSetup): "halves" | "quarters" {
  if ((s.tireDiameterFrontLeft ?? null) === (s.tireDiameterFrontRight ?? null) && (s.tireDiameterRearLeft ?? null) === (s.tireDiameterRearRight ?? null)) return "halves";
  return "quarters";
}

export function SetupsTab({ karts, setups, onAdd, onUpdate, onRemove, onGetLatestForKart }: SetupsTabProps) {
  const [mode, setMode] = useState<FormMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [preloaded, setPreloaded] = useState(false);
  const preloadSnapshot = useRef<Record<string, unknown> | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // PSI display state (separate from form.psiMode for display toggling)
  const [psiSingle, setPsiSingle] = useState<number | null>(null);
  const [psiFront, setPsiFront] = useState<number | null>(null);
  const [psiRear, setPsiRear] = useState<number | null>(null);

  // Width display state
  const [widthFront, setWidthFront] = useState<number | null>(null);
  const [widthRear, setWidthRear] = useState<number | null>(null);

  // Diameter display state
  const [diamFront, setDiamFront] = useState<number | null>(null);
  const [diamRear, setDiamRear] = useState<number | null>(null);

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setPreloaded(false);
    preloadSnapshot.current = null;
    setPsiSingle(null);
    setPsiFront(null);
    setPsiRear(null);
    setWidthFront(null);
    setWidthRear(null);
    setDiamFront(null);
    setDiamRear(null);
  }, []);

  /** Check if a form field was changed from the preloaded value */
  const isChanged = useCallback((key: string, currentValue: unknown): boolean => {
    if (!preloaded || !preloadSnapshot.current) return false;
    const original = preloadSnapshot.current[key];
    return original !== currentValue;
  }, [preloaded]);

  const openNew = useCallback(() => {
    resetForm();
    setEditingId(null);
    setMode("new");
  }, [resetForm]);

  const openEdit = useCallback((setup: KartSetup) => {
    setEditingId(setup.id);
    const psiMode = detectPsiMode(setup);
    const widthMode = detectWidthMode(setup);
    const diamMode = detectDiameterMode(setup);
    setForm({
      kartId: setup.kartId,
      name: setup.name,
      toe: setup.toe,
      camber: setup.camber,
      castor: setup.castor,
      frontWidth: setup.frontWidth,
      frontWidthUnit: setup.frontWidthUnit,
      rearWidth: setup.rearWidth,
      rearWidthUnit: setup.rearWidthUnit,
      rearHeight: setup.rearHeight,
      rearHeightUnit: setup.rearHeightUnit,
      frontSprocket: setup.frontSprocket,
      rearSprocket: setup.rearSprocket,
      steeringBrand: setup.steeringBrand,
      steeringSetting: setup.steeringSetting,
      spindleSetting: setup.spindleSetting,
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
      tireWidthUnit: setup.tireWidthUnit,
      tireDiameterMode: diamMode,
      tireDiameterFrontLeft: setup.tireDiameterFrontLeft ?? null,
      tireDiameterFrontRight: setup.tireDiameterFrontRight ?? null,
      tireDiameterRearLeft: setup.tireDiameterRearLeft ?? null,
      tireDiameterRearRight: setup.tireDiameterRearRight ?? null,
      tireDiameterUnit: setup.tireDiameterUnit ?? "mm",
    });
    // Set display helpers
    if (psiMode === "single") setPsiSingle(setup.psiFrontLeft);
    else setPsiSingle(null);
    if (psiMode === "halves") {
      setPsiFront(setup.psiFrontLeft);
      setPsiRear(setup.psiRearLeft);
    }
    if (widthMode === "halves") {
      setWidthFront(setup.tireWidthFrontLeft);
      setWidthRear(setup.tireWidthRearLeft);
    }
    if (diamMode === "halves") {
      setDiamFront(setup.tireDiameterFrontLeft ?? null);
      setDiamRear(setup.tireDiameterRearLeft ?? null);
    }
    setPreloaded(false);
    setMode("edit");
  }, []);

  const handleKartChange = useCallback(async (kartId: string) => {
    setForm((prev) => ({ ...prev, kartId }));
    if (mode !== "new") return;
    const latest = await onGetLatestForKart(kartId);
    if (latest) {
      const psiMode = detectPsiMode(latest);
      const widthMode = detectWidthMode(latest);
      const diamMode = detectDiameterMode(latest);
      setForm((prev) => ({
        ...prev,
        kartId,
        name: prev.name,
        toe: latest.toe,
        camber: latest.camber,
        castor: latest.castor,
        frontWidth: latest.frontWidth,
        frontWidthUnit: latest.frontWidthUnit,
        rearWidth: latest.rearWidth,
        rearWidthUnit: latest.rearWidthUnit,
        rearHeight: latest.rearHeight,
        rearHeightUnit: latest.rearHeightUnit,
        frontSprocket: latest.frontSprocket,
        rearSprocket: latest.rearSprocket,
        steeringBrand: latest.steeringBrand,
        steeringSetting: latest.steeringSetting,
        spindleSetting: latest.spindleSetting,
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
        tireWidthUnit: latest.tireWidthUnit,
        tireDiameterMode: diamMode,
        tireDiameterFrontLeft: latest.tireDiameterFrontLeft ?? null,
        tireDiameterFrontRight: latest.tireDiameterFrontRight ?? null,
        tireDiameterRearLeft: latest.tireDiameterRearLeft ?? null,
        tireDiameterRearRight: latest.tireDiameterRearRight ?? null,
        tireDiameterUnit: latest.tireDiameterUnit ?? "mm",
      }));
      if (psiMode === "single") setPsiSingle(latest.psiFrontLeft);
      if (psiMode === "halves") { setPsiFront(latest.psiFrontLeft); setPsiRear(latest.psiRearLeft); }
      if (widthMode === "halves") { setWidthFront(latest.tireWidthFrontLeft); setWidthRear(latest.tireWidthRearLeft); }
      if (diamMode === "halves") { setDiamFront(latest.tireDiameterFrontLeft ?? null); setDiamRear(latest.tireDiameterRearLeft ?? null); }
      // Save snapshot for change highlighting
      preloadSnapshot.current = {
        toe: latest.toe, camber: latest.camber, castor: latest.castor,
        frontWidth: latest.frontWidth, rearWidth: latest.rearWidth, rearHeight: latest.rearHeight,
        frontWidthUnit: latest.frontWidthUnit, rearWidthUnit: latest.rearWidthUnit, rearHeightUnit: latest.rearHeightUnit,
        frontSprocket: latest.frontSprocket, rearSprocket: latest.rearSprocket,
        steeringBrand: latest.steeringBrand, steeringSetting: latest.steeringSetting, spindleSetting: latest.spindleSetting,
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
        diamFront: diamMode === "halves" ? (latest.tireDiameterFrontLeft ?? null) : null,
        diamRear: diamMode === "halves" ? (latest.tireDiameterRearLeft ?? null) : null,
        tireDiameterFrontLeft: latest.tireDiameterFrontLeft ?? null, tireDiameterFrontRight: latest.tireDiameterFrontRight ?? null,
        tireDiameterRearLeft: latest.tireDiameterRearLeft ?? null, tireDiameterRearRight: latest.tireDiameterRearRight ?? null,
      };
      setPreloaded(true);
    }
  }, [mode, onGetLatestForKart]);

  const handleSave = useCallback(async () => {
    let finalForm = { ...form };
    // Build final PSI fields based on mode
    if (form.psiMode === "single" && psiSingle !== null) {
      finalForm = { ...finalForm, psiFrontLeft: psiSingle, psiFrontRight: psiSingle, psiRearLeft: psiSingle, psiRearRight: psiSingle };
    } else if (form.psiMode === "halves") {
      finalForm = { ...finalForm, psiFrontLeft: psiFront, psiFrontRight: psiFront, psiRearLeft: psiRear, psiRearRight: psiRear };
    }
    // Build final width fields based on mode
    if (form.tireWidthMode === "halves") {
      finalForm = { ...finalForm, tireWidthFrontLeft: widthFront, tireWidthFrontRight: widthFront, tireWidthRearLeft: widthRear, tireWidthRearRight: widthRear };
    }
    // Build final diameter fields based on mode
    if (form.tireDiameterMode === "halves") {
      finalForm = { ...finalForm, tireDiameterFrontLeft: diamFront, tireDiameterFrontRight: diamFront, tireDiameterRearLeft: diamRear, tireDiameterRearRight: diamRear };
    }

    if (mode === "edit" && editingId) {
      const existing = setups.find((s) => s.id === editingId)!;
      await onUpdate({ ...existing, ...finalForm, id: editingId });
    } else {
      await onAdd(finalForm);
    }
    resetForm();
    setMode("list");
  }, [form, psiSingle, psiFront, psiRear, widthFront, widthRear, diamFront, diamRear, mode, editingId, setups, onAdd, onUpdate, resetForm]);

  const canSave = form.kartId && form.name.trim() && hasAnySetting(form, psiSingle, psiFront, psiRear, widthFront, widthRear, diamFront, diamRear);

  // ── List View ──
  if (mode === "list") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {setups.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 py-16">
              <Wrench className="w-12 h-12 opacity-30" />
              <p className="text-sm font-medium">No setups yet</p>
              <p className="text-xs">Use the button below to add one.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {setups.map((setup) => {
                const kart = karts.find((k) => k.id === setup.kartId);
                const isDeleting = deleteConfirmId === setup.id;
                return (
                  <div key={setup.id}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{setup.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {kart?.name ?? "Unknown kart"} · {new Date(setup.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => openEdit(setup)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmId(setup.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {isDeleting && (
                      <div className="mx-3 mb-1 p-2 rounded-md bg-destructive/10 border border-destructive/30 flex items-center gap-2">
                        <span className="text-xs text-destructive flex-1">Delete this setup?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 text-xs px-2"
                          onClick={async () => { await onRemove(setup.id); setDeleteConfirmId(null); }}
                        >
                          Confirm
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDeleteConfirmId(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="shrink-0 px-3 py-3 border-t border-border">
          <Button className="w-full gap-2" onClick={openNew}>
            <Plus className="w-4 h-4" /> Add New Setup
          </Button>
        </div>
      </div>
    );
  }

  // ── Form View ──
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
            <Info className="w-3 h-3" /> Pre-loaded from last setup
          </span>
        )}
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Section: Kart & Name */}
        <Section>
          <Field label="Kart">
            <Select value={form.kartId} onValueChange={handleKartChange}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select kart…" /></SelectTrigger>
              <SelectContent>
                {karts.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Setup Name">
            <Input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Race Day Dry"
              className="h-9"
            />
          </Field>
        </Section>

        {/* Alignment */}
        <Section title="Alignment">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Toe" changed={isChanged("toe", form.toe)}>
              <NumberInput step="1" className="h-9" value={form.toe ?? ""} onChange={(e) => setForm((p) => ({ ...p, toe: e.target.value === "" ? null : parseInt(e.target.value) }))} />
            </Field>
            <Field label="Camber" changed={isChanged("camber", form.camber)}>
              <NumberInput step="1" className="h-9" value={form.camber ?? ""} onChange={(e) => setForm((p) => ({ ...p, camber: e.target.value === "" ? null : parseInt(e.target.value) }))} />
            </Field>
            <Field label="Castor" changed={isChanged("castor", form.castor)}>
              <NumberInput step="1" className="h-9" value={form.castor ?? ""} onChange={(e) => setForm((p) => ({ ...p, castor: e.target.value === "" ? null : parseInt(e.target.value) }))} />
            </Field>
          </div>
        </Section>

        {/* Dimensions */}
        <Section title="Dimensions">
          <DimensionRow label="Front Width" value={form.frontWidth} unit={form.frontWidthUnit} onValue={(v) => setForm((p) => ({ ...p, frontWidth: v }))} onUnit={(u) => setForm((p) => ({ ...p, frontWidthUnit: u }))} changed={isChanged("frontWidth", form.frontWidth)} />
          <DimensionRow label="Rear Width" value={form.rearWidth} unit={form.rearWidthUnit} onValue={(v) => setForm((p) => ({ ...p, rearWidth: v }))} onUnit={(u) => setForm((p) => ({ ...p, rearWidthUnit: u }))} changed={isChanged("rearWidth", form.rearWidth)} />
          <DimensionRow label="Rear Height" value={form.rearHeight} unit={form.rearHeightUnit} onValue={(v) => setForm((p) => ({ ...p, rearHeight: v }))} onUnit={(u) => setForm((p) => ({ ...p, rearHeightUnit: u }))} changed={isChanged("rearHeight", form.rearHeight)} />
        </Section>

        {/* Sprockets */}
        <Section title="Sprockets">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Front" changed={isChanged("frontSprocket", form.frontSprocket)}>
              <NumberInput step="1" className="h-9" value={form.frontSprocket ?? ""} onChange={(e) => setForm((p) => ({ ...p, frontSprocket: e.target.value === "" ? null : parseInt(e.target.value) }))} />
            </Field>
            <Field label="Rear" changed={isChanged("rearSprocket", form.rearSprocket)}>
              <NumberInput step="1" className="h-9" value={form.rearSprocket ?? ""} onChange={(e) => setForm((p) => ({ ...p, rearSprocket: e.target.value === "" ? null : parseInt(e.target.value) }))} />
            </Field>
          </div>
        </Section>

        {/* Steering */}
        <Section title="Steering">
          <Field label="Column Brand" changed={isChanged("steeringBrand", form.steeringBrand)}>
            <Input className="h-9" value={form.steeringBrand} onChange={(e) => setForm((p) => ({ ...p, steeringBrand: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Steering (1-5)" changed={isChanged("steeringSetting", form.steeringSetting)}>
              <NumberInput min={1} max={5} step="1" className="h-9" value={form.steeringSetting ?? ""} onChange={(e) => setForm((p) => ({ ...p, steeringSetting: e.target.value === "" ? null : parseInt(e.target.value) }))} />
            </Field>
            <Field label="Spindle (1-5)" changed={isChanged("spindleSetting", form.spindleSetting)}>
              <NumberInput min={1} max={5} step="1" className="h-9" value={form.spindleSetting ?? ""} onChange={(e) => setForm((p) => ({ ...p, spindleSetting: e.target.value === "" ? null : parseInt(e.target.value) }))} />
            </Field>
          </div>
        </Section>

        {/* Tires */}
        <Section title="Tires">
          <Field label="Tire Brand" changed={isChanged("tireBrand", form.tireBrand)}>
            <Input className="h-9" value={form.tireBrand} onChange={(e) => setForm((p) => ({ ...p, tireBrand: e.target.value }))} />
          </Field>
        </Section>

        {/* Tire PSI */}
        <Section title="Tire PSI">
          <ModeToggle
            options={["single", "halves", "quarters"] as const}
            labels={["Single", "Halves", "Quarters"]}
            value={form.psiMode}
            onChange={(v) => setForm((p) => ({ ...p, psiMode: v }))}
          />
          {form.psiMode === "single" && (
            <Field label="All Tires" changed={isChanged("psiSingle", psiSingle)}>
              <NumberInput step="0.01" className="h-9" value={psiSingle ?? ""} onChange={(e) => setPsiSingle(e.target.value === "" ? null : parseFloat(e.target.value))} />
            </Field>
          )}
          {form.psiMode === "halves" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Front" changed={isChanged("psiFront", psiFront)}>
                <NumberInput step="0.01" className="h-9" value={psiFront ?? ""} onChange={(e) => setPsiFront(e.target.value === "" ? null : parseFloat(e.target.value))} />
              </Field>
              <Field label="Rear" changed={isChanged("psiRear", psiRear)}>
                <NumberInput step="0.01" className="h-9" value={psiRear ?? ""} onChange={(e) => setPsiRear(e.target.value === "" ? null : parseFloat(e.target.value))} />
              </Field>
            </div>
          )}
          {form.psiMode === "quarters" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="FL" changed={isChanged("psiFrontLeft", form.psiFrontLeft)}>
                <NumberInput step="0.01" className="h-9" value={form.psiFrontLeft ?? ""} onChange={(e) => setForm((p) => ({ ...p, psiFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="FR" changed={isChanged("psiFrontRight", form.psiFrontRight)}>
                <NumberInput step="0.01" className="h-9" value={form.psiFrontRight ?? ""} onChange={(e) => setForm((p) => ({ ...p, psiFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="RL" changed={isChanged("psiRearLeft", form.psiRearLeft)}>
                <NumberInput step="0.01" className="h-9" value={form.psiRearLeft ?? ""} onChange={(e) => setForm((p) => ({ ...p, psiRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="RR" changed={isChanged("psiRearRight", form.psiRearRight)}>
                <NumberInput step="0.01" className="h-9" value={form.psiRearRight ?? ""} onChange={(e) => setForm((p) => ({ ...p, psiRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
            </div>
          )}
        </Section>

        {/* Tire Widths */}
        <Section title="Tire Widths">
          <div className="flex items-center justify-between mb-2">
            <ModeToggle
              options={["halves", "quarters"] as const}
              labels={["Halves", "Quarters"]}
              value={form.tireWidthMode}
              onChange={(v) => setForm((p) => ({ ...p, tireWidthMode: v }))}
            />
            <UnitSwitch value={form.tireWidthUnit} onChange={(u) => setForm((p) => ({ ...p, tireWidthUnit: u }))} />
          </div>
          {form.tireWidthMode === "halves" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Front" changed={isChanged("widthFront", widthFront)}>
                <NumberInput step="0.01" className="h-9" value={widthFront ?? ""} onChange={(e) => setWidthFront(e.target.value === "" ? null : parseFloat(e.target.value))} />
              </Field>
              <Field label="Rear" changed={isChanged("widthRear", widthRear)}>
                <NumberInput step="0.01" className="h-9" value={widthRear ?? ""} onChange={(e) => setWidthRear(e.target.value === "" ? null : parseFloat(e.target.value))} />
              </Field>
            </div>
          )}
          {form.tireWidthMode === "quarters" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="FL" changed={isChanged("tireWidthFrontLeft", form.tireWidthFrontLeft)}>
                <NumberInput step="0.01" className="h-9" value={form.tireWidthFrontLeft ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireWidthFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="FR" changed={isChanged("tireWidthFrontRight", form.tireWidthFrontRight)}>
                <NumberInput step="0.01" className="h-9" value={form.tireWidthFrontRight ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireWidthFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="RL" changed={isChanged("tireWidthRearLeft", form.tireWidthRearLeft)}>
                <NumberInput step="0.01" className="h-9" value={form.tireWidthRearLeft ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireWidthRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="RR" changed={isChanged("tireWidthRearRight", form.tireWidthRearRight)}>
                <NumberInput step="0.01" className="h-9" value={form.tireWidthRearRight ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireWidthRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
            </div>
          )}
        </Section>

        {/* Tire Diameter */}
        <Section title="Tire Diameter">
          <div className="flex items-center justify-between mb-2">
            <ModeToggle
              options={["halves", "quarters"] as const}
              labels={["Halves", "Quarters"]}
              value={form.tireDiameterMode}
              onChange={(v) => setForm((p) => ({ ...p, tireDiameterMode: v }))}
            />
            <UnitSwitch value={form.tireDiameterUnit} onChange={(u) => setForm((p) => ({ ...p, tireDiameterUnit: u }))} />
          </div>
          {form.tireDiameterMode === "halves" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Front" changed={isChanged("diamFront", diamFront)}>
                <NumberInput step="0.01" className="h-9" value={diamFront ?? ""} onChange={(e) => setDiamFront(e.target.value === "" ? null : parseFloat(e.target.value))} />
              </Field>
              <Field label="Rear" changed={isChanged("diamRear", diamRear)}>
                <NumberInput step="0.01" className="h-9" value={diamRear ?? ""} onChange={(e) => setDiamRear(e.target.value === "" ? null : parseFloat(e.target.value))} />
              </Field>
            </div>
          )}
          {form.tireDiameterMode === "quarters" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="FL" changed={isChanged("tireDiameterFrontLeft", form.tireDiameterFrontLeft)}>
                <NumberInput step="0.01" className="h-9" value={form.tireDiameterFrontLeft ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireDiameterFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="FR" changed={isChanged("tireDiameterFrontRight", form.tireDiameterFrontRight)}>
                <NumberInput step="0.01" className="h-9" value={form.tireDiameterFrontRight ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireDiameterFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="RL" changed={isChanged("tireDiameterRearLeft", form.tireDiameterRearLeft)}>
                <NumberInput step="0.01" className="h-9" value={form.tireDiameterRearLeft ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireDiameterRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
              <Field label="RR" changed={isChanged("tireDiameterRearRight", form.tireDiameterRearRight)}>
                <NumberInput step="0.01" className="h-9" value={form.tireDiameterRearRight ?? ""} onChange={(e) => setForm((p) => ({ ...p, tireDiameterRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
              </Field>
            </div>
          )}
        </Section>
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

function hasAnySetting(
  f: Omit<KartSetup, "id" | "createdAt" | "updatedAt">,
  psiSingle: number | null,
  psiFront: number | null,
  psiRear: number | null,
  widthFront: number | null,
  widthRear: number | null,
  diamFront: number | null,
  diamRear: number | null,
): boolean {
  return !!(
    f.toe !== null || f.camber !== null || f.castor !== null ||
    f.frontWidth !== null || f.rearWidth !== null || f.rearHeight !== null ||
    f.frontSprocket !== null || f.rearSprocket !== null ||
    f.steeringBrand || f.steeringSetting !== null || f.spindleSetting !== null ||
    f.tireBrand ||
    psiSingle !== null || psiFront !== null || psiRear !== null ||
    f.psiFrontLeft !== null || f.psiFrontRight !== null || f.psiRearLeft !== null || f.psiRearRight !== null ||
    widthFront !== null || widthRear !== null ||
    f.tireWidthFrontLeft !== null || f.tireWidthFrontRight !== null || f.tireWidthRearLeft !== null || f.tireWidthRearRight !== null ||
    diamFront !== null || diamRear !== null ||
    f.tireDiameterFrontLeft !== null || f.tireDiameterFrontRight !== null || f.tireDiameterRearLeft !== null || f.tireDiameterRearRight !== null
  );
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

function DimensionRow({
  label, value, unit, onValue, onUnit, changed,
}: {
  label: string;
  value: number | null;
  unit: "mm" | "in";
  onValue: (v: number | null) => void;
  onUnit: (u: "mm" | "in") => void;
  changed?: boolean;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Field label={label} changed={changed}>
          <NumberInput step="0.01" className="h-9" value={value ?? ""} onChange={(e) => onValue(e.target.value === "" ? null : parseFloat(e.target.value))} />
        </Field>
      </div>
      <UnitSwitch value={unit} onChange={onUnit} />
    </div>
  );
}

function UnitSwitch({ value, onChange }: { value: "mm" | "in"; onChange: (u: "mm" | "in") => void }) {
  return (
    <div className="flex items-center gap-1.5 pb-0.5">
      <span className={`text-xs ${value === "mm" ? "text-foreground font-medium" : "text-muted-foreground"}`}>mm</span>
      <Switch
        checked={value === "in"}
        onCheckedChange={(checked) => onChange(checked ? "in" : "mm")}
        className="h-5 w-9"
      />
      <span className={`text-xs ${value === "in" ? "text-foreground font-medium" : "text-muted-foreground"}`}>in</span>
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
