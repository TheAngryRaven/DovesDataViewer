import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Wrench, Plus, ArrowLeft, Pencil, Trash2, Info, Car, History, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { VehicleType, SetupTemplate, TemplateSection, TemplateFieldDef } from "@/lib/templateStorage";
import { TemplateCreator } from "@/components/drawer/TemplateCreator";
import { VehicleTypeEditor } from "@/components/drawer/VehicleTypeEditor";
import { ModeToggle } from "@/components/drawer/ModeToggle";
import { computeSetupHash, shortRevHash } from "@/lib/setupRevision";
import { SetupHistoryPanel } from "@/components/drawer/SetupHistoryPanel";
import { useAuth } from "@/contexts/AuthContext";

interface SetupsTabProps {
  vehicles: Vehicle[];
  setups: VehicleSetup[];
  vehicleTypes: VehicleType[];
  templates: SetupTemplate[];
  onAdd: (setup: Omit<VehicleSetup, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onUpdate: (setup: VehicleSetup) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onGetLatestForVehicle: (vehicleId: string) => Promise<VehicleSetup | null>;
  onAddVehicleType: (name: string, wheelCount: 2 | 4, includeTires: boolean, sections: TemplateSection[]) => Promise<unknown>;
  onRemoveVehicleType: (vehicleTypeId: string, templateId: string) => Promise<void>;
  onUpdateVehicleType: (vehicleType: VehicleType, template: SetupTemplate) => Promise<void>;
  /** When toggled true, jump straight into the vehicle-type creator (e.g. from
   *  the Vehicles tab's "New type" shortcut). Cleared via onRequestNewTypeHandled. */
  requestNewType?: boolean;
  onRequestNewTypeHandled?: () => void;
  /** Open the garage to the Vehicles tab (setups require a vehicle to attach to). */
  onCreateVehicle?: () => void;
}

type FormMode = "list" | "new" | "edit" | "new-type" | "manage-type" | "history";

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
  onAddVehicleType, onRemoveVehicleType, onUpdateVehicleType,
  requestNewType, onRequestNewTypeHandled,
  onCreateVehicle,
}: SetupsTabProps) {
  const { t } = useTranslation("drawer");
  const [mode, setMode] = useState<FormMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  // "Copy setup from…" dialog state (copy another same-type vehicle's setup).
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyVehicleId, setCopyVehicleId] = useState("");
  const [copySetupId, setCopySetupId] = useState("");
  const [preloaded, setPreloaded] = useState(false);
  const preloadSnapshot = useRef<Record<string, unknown> | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [historySetup, setHistorySetup] = useState<VehicleSetup | null>(null);
  const { user } = useAuth();

  // The content hash each setup would freeze to right now (git-style short id).
  // Shown so two sessions on the same setup read the same #hash, and an edited
  // setup reads a different one. Recomputed when setups or templates change.
  const [setupHashes, setSetupHashes] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const s of setups) {
        const tpl = templates.find(tt => tt.id === s.templateId) ?? null;
        next[s.id] = shortRevHash(await computeSetupHash(s, tpl));
      }
      if (!cancelled) setSetupHashes(next);
    })();
    return () => { cancelled = true; };
  }, [setups, templates]);

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

  // Copy a source setup's values into the current form, keeping the form's own
  // target vehicle and name. Shared by the per-vehicle preload and the explicit
  // "Copy setup from…" dialog. Also seeds the change-highlight snapshot.
  const applySourceSetup = useCallback((source: VehicleSetup) => {
    const psiMode = detectPsiMode(source);
    const widthMode = detectWidthMode(source);
    const diamMode = detectDiameterMode(source);
    setForm(prev => ({
      ...prev,
      templateId: source.templateId,
      unitSystem: source.unitSystem || "mm",
      tireBrand: source.tireBrand,
      psiMode,
      psiFrontLeft: source.psiFrontLeft,
      psiFrontRight: source.psiFrontRight,
      psiRearLeft: source.psiRearLeft,
      psiRearRight: source.psiRearRight,
      tireWidthMode: widthMode,
      tireWidthFrontLeft: source.tireWidthFrontLeft,
      tireWidthFrontRight: source.tireWidthFrontRight,
      tireWidthRearLeft: source.tireWidthRearLeft,
      tireWidthRearRight: source.tireWidthRearRight,
      tireDiameterMode: diamMode,
      tireDiameterFrontLeft: source.tireDiameterFrontLeft,
      tireDiameterFrontRight: source.tireDiameterFrontRight,
      tireDiameterRearLeft: source.tireDiameterRearLeft,
      tireDiameterRearRight: source.tireDiameterRearRight,
      customFields: { ...source.customFields },
    }));
    if (psiMode === "single") setPsiSingle(source.psiFrontLeft);
    if (psiMode === "halves") { setPsiFront(source.psiFrontLeft); setPsiRear(source.psiRearLeft); }
    if (widthMode === "halves") { setWidthFront(source.tireWidthFrontLeft); setWidthRear(source.tireWidthRearLeft); }
    if (diamMode === "halves") { setDiamFront(source.tireDiameterFrontLeft); setDiamRear(source.tireDiameterRearLeft); }
    // Snapshot for change highlighting
    preloadSnapshot.current = {
      ...source.customFields,
      tireBrand: source.tireBrand,
      psiSingle: psiMode === "single" ? source.psiFrontLeft : null,
      psiFront: psiMode === "halves" ? source.psiFrontLeft : null,
      psiRear: psiMode === "halves" ? source.psiRearLeft : null,
      psiFrontLeft: source.psiFrontLeft, psiFrontRight: source.psiFrontRight,
      psiRearLeft: source.psiRearLeft, psiRearRight: source.psiRearRight,
      widthFront: widthMode === "halves" ? source.tireWidthFrontLeft : null,
      widthRear: widthMode === "halves" ? source.tireWidthRearLeft : null,
      tireWidthFrontLeft: source.tireWidthFrontLeft, tireWidthFrontRight: source.tireWidthFrontRight,
      tireWidthRearLeft: source.tireWidthRearLeft, tireWidthRearRight: source.tireWidthRearRight,
      diamFront: diamMode === "halves" ? source.tireDiameterFrontLeft : null,
      diamRear: diamMode === "halves" ? source.tireDiameterRearLeft : null,
      tireDiameterFrontLeft: source.tireDiameterFrontLeft, tireDiameterFrontRight: source.tireDiameterFrontRight,
      tireDiameterRearLeft: source.tireDiameterRearLeft, tireDiameterRearRight: source.tireDiameterRearRight,
    };
    setPreloaded(true);
  }, []);

  const handleVehicleChange = useCallback(async (vehicleId: string) => {
    setForm(prev => ({ ...prev, vehicleId }));
    if (mode !== "new") return;
    const latest = await onGetLatestForVehicle(vehicleId);
    if (latest) applySourceSetup(latest);
  }, [mode, onGetLatestForVehicle, applySourceSetup]);

  const handleTypeChange = useCallback((typeId: string) => {
    setSelectedTypeId(typeId);
    const vt = vehicleTypes.find(v => v.id === typeId);
    const tpl = vt ? templates.find(t => t.id === vt.templateId) : null;
    if (tpl) {
      setForm(prev => ({ ...prev, templateId: tpl.id, vehicleId: "" }));
    }
  }, [vehicleTypes, templates]);

  // New-setup defaults: with a single vehicle type, pre-select it; with a single
  // candidate vehicle, pre-select that too (which also preloads its latest
  // setup). Both pickers stay visible — these are convenience defaults, not locks.
  useEffect(() => {
    if (mode !== "new") return;
    if (!selectedTypeId && vehicleTypes.length === 1) {
      handleTypeChange(vehicleTypes[0].id);
      return;
    }
    if (selectedTypeId && filteredVehicles.length === 1 && form.vehicleId !== filteredVehicles[0].id) {
      handleVehicleChange(filteredVehicles[0].id);
    }
  }, [mode, selectedTypeId, vehicleTypes, filteredVehicles, form.vehicleId, handleTypeChange, handleVehicleChange]);

  // External shortcut (the Vehicles tab's "New type" button) drops the user
  // straight into the vehicle-type creator. The parent clears the request once
  // handled so it fires once per click.
  useEffect(() => {
    if (!requestNewType) return;
    setMode("new-type");
    onRequestNewTypeHandled?.();
  }, [requestNewType, onRequestNewTypeHandled]);

  // "Copy setup from…": same-type vehicles that already have a setup to copy.
  const copyableVehicles = useMemo(
    () => filteredVehicles.filter(v => setups.some(s => s.vehicleId === v.id)),
    [filteredVehicles, setups],
  );
  const copyVehicleSetups = useMemo(
    () => setups.filter(s => s.vehicleId === copyVehicleId),
    [setups, copyVehicleId],
  );

  const openCopy = useCallback(() => {
    const firstVehicle = copyableVehicles[0]?.id ?? "";
    setCopyVehicleId(firstVehicle);
    setCopySetupId(setups.find(s => s.vehicleId === firstVehicle)?.id ?? "");
    setCopyOpen(true);
  }, [copyableVehicles, setups]);

  const handleCopyVehicleChange = useCallback((vehicleId: string) => {
    setCopyVehicleId(vehicleId);
    setCopySetupId(setups.find(s => s.vehicleId === vehicleId)?.id ?? "");
  }, [setups]);

  const handleCopyConfirm = useCallback(() => {
    const source = setups.find(s => s.id === copySetupId);
    if (source) applySourceSetup(source);
    setCopyOpen(false);
  }, [copySetupId, setups, applySourceSetup]);

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

  // ── Setup History ──
  if (mode === "history" && historySetup) {
    return (
      <SetupHistoryPanel
        setup={historySetup}
        vehicles={vehicles}
        onBack={() => { setHistorySetup(null); setMode("list"); }}
      />
    );
  }

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

  // ── Vehicle Type Editor ──
  if (mode === "manage-type") {
    return (
      <VehicleTypeEditor
        vehicleTypes={vehicleTypes}
        templates={templates}
        setups={setups}
        onUpdate={onUpdateVehicleType}
        onDone={() => setMode("list")}
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
              <p className="text-sm font-medium text-destructive">{t("setups.empty")}</p>
              <p className="text-xs">{t("setups.emptyHint")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {setups.map(setup => {
                const vehicle = vehicles.find(v => v.id === setup.vehicleId);
                const vt = vehicle ? vehicleTypes.find(vtt => vtt.id === vehicle.vehicleTypeId) : null;
                const isDeleting = deleteConfirmId === setup.id;
                return (
                  <div key={setup.id}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{setup.name}</p>
                          {setupHashes[setup.id] && (
                            <span
                              className="shrink-0 font-mono text-[10px] text-muted-foreground"
                              title={t("setups.revisionTitle", { hash: setupHashes[setup.id] })}
                            >
                              #{setupHashes[setup.id]}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {vehicle?.name ?? t("setups.unknownVehicle")}{vt ? ` (${vt.name})` : ""} · {new Date(setup.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={t("setupHistory.openTitle")} onClick={() => { setHistorySetup(setup); setMode("history"); }}>
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => openEdit(setup)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => setDeleteConfirmId(setup.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {isDeleting && (
                      <div className="mx-3 mb-1 p-2 rounded-md bg-destructive/10 border border-destructive/30 flex items-center gap-2">
                        <span className="text-xs text-destructive flex-1">
                          {user ? t("setups.deleteConfirmCloud") : t("setups.deleteConfirm")}
                        </span>
                        <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={async () => { await onRemove(setup.id); setDeleteConfirmId(null); }}>{t("setups.confirm")}</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDeleteConfirmId(null)}>{t("setups.cancel")}</Button>
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
            <Car className="w-4 h-4" /> {t("setups.newVehicleType")}
          </Button>
          <Button variant="outline" className="w-full gap-2" onClick={() => setMode("manage-type")}>
            <Pencil className="w-4 h-4" /> {t("setups.manageVehicleTypes")}
          </Button>
          {/* A setup must attach to a vehicle — block new setups until one exists
              and point the user at the Vehicles tab. */}
          <Button className="w-full gap-2" onClick={openNew} disabled={vehicles.length === 0}>
            <Plus className="w-4 h-4" /> {t("setups.addNewSetup")}
          </Button>
          {vehicles.length === 0 && onCreateVehicle && (
            <Button className="w-full gap-2" onClick={onCreateVehicle}>
              <Car className="w-4 h-4" /> {t("setups.firstCreateVehicle")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Form View ──
  const wheelCount = currentTemplate?.wheelCount ?? 4;
  const psiOptions = wheelCount === 2 ? (["single", "halves"] as const) : (["single", "halves", "quarters"] as const);
  const psiLabels = wheelCount === 2 ? [t("setups.single"), t("setups.halves")] : [t("setups.single"), t("setups.halves"), t("setups.quarters")];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { resetForm(); setMode("list"); }}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground flex-1">
          {mode === "edit" ? t("setups.editSetup") : t("setups.newSetup")}
        </h3>
        {preloaded && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Info className="w-3 h-3" /> {t("setups.preloaded")}
          </span>
        )}
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Vehicle Type & Vehicle Selection */}
        <Section>
          {/* A single option leaves nothing to choose — populate (via the effect
              above) and lock the picker. */}
          {mode === "new" && (
            <Field label={t("setups.vehicleType")}>
              <Select value={selectedTypeId} onValueChange={handleTypeChange} disabled={vehicleTypes.length <= 1}>
                <SelectTrigger className="h-9"><SelectValue placeholder={t("setups.selectType")} /></SelectTrigger>
                <SelectContent>
                  {vehicleTypes.map(vt => (
                    <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {/* Bootstrap a new setup from a same-type vehicle that already has one. */}
          {mode === "new" && selectedTypeId && copyableVehicles.length > 0 && (
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={openCopy}>
              <Copy className="w-4 h-4" /> {t("setups.copyFrom")}
            </Button>
          )}
          <Field label={t("setups.vehicle")}>
            <Select value={form.vehicleId} onValueChange={handleVehicleChange} disabled={filteredVehicles.length <= 1}>
              <SelectTrigger className="h-9"><SelectValue placeholder={t("setups.selectVehicle")} /></SelectTrigger>
              <SelectContent>
                {filteredVehicles.map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("setups.setupName")}>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t("setups.setupNamePlaceholder")} className="h-9" />
          </Field>
        </Section>

        {/* Global Unit Toggle — only if template has measurement fields */}
        {currentTemplate && currentTemplate.sections.some(s => s.fields.some(f => f.unit === "mm" || f.unit === "in")) && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">{t("setups.measurementUnits")}</span>
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
            <Section title={t("setups.tires")}>
              <Field label={t("setups.tireBrand")} changed={isChanged("tireBrand", form.tireBrand)}>
                <Input className="h-9" value={form.tireBrand} onChange={e => setForm(p => ({ ...p, tireBrand: e.target.value }))} />
              </Field>
            </Section>

            <Section title={t("setups.tirePsi")}>
              <ModeToggle options={psiOptions} labels={psiLabels} value={form.psiMode} onChange={v => setForm(p => ({ ...p, psiMode: v }))} />
              {form.psiMode === "single" && (
                <Field label={t("setups.allTires")} changed={isChanged("psiSingle", psiSingle)}>
                  <NumberInput step="0.01" className="h-9" value={psiSingle ?? ""} onChange={e => setPsiSingle(e.target.value === "" ? null : parseFloat(e.target.value))} />
                </Field>
              )}
              {form.psiMode === "halves" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.front")} changed={isChanged("psiFront", psiFront)}>
                    <NumberInput step="0.01" className="h-9" value={psiFront ?? ""} onChange={e => setPsiFront(e.target.value === "" ? null : parseFloat(e.target.value))} />
                  </Field>
                  <Field label={t("setups.rear")} changed={isChanged("psiRear", psiRear)}>
                    <NumberInput step="0.01" className="h-9" value={psiRear ?? ""} onChange={e => setPsiRear(e.target.value === "" ? null : parseFloat(e.target.value))} />
                  </Field>
                </div>
              )}
              {form.psiMode === "quarters" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.fl")}><NumberInput step="0.01" className="h-9" value={form.psiFrontLeft ?? ""} onChange={e => setForm(p => ({ ...p, psiFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.fr")}><NumberInput step="0.01" className="h-9" value={form.psiFrontRight ?? ""} onChange={e => setForm(p => ({ ...p, psiFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.rl")}><NumberInput step="0.01" className="h-9" value={form.psiRearLeft ?? ""} onChange={e => setForm(p => ({ ...p, psiRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.rr")}><NumberInput step="0.01" className="h-9" value={form.psiRearRight ?? ""} onChange={e => setForm(p => ({ ...p, psiRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                </div>
              )}
            </Section>

            {/* Tire Widths */}
            <Section title={t("setups.tireWidths", { unit: form.unitSystem })}>
              <ModeToggle
                options={wheelCount === 2 ? (["halves"] as const) : (["halves", "quarters"] as const)}
                labels={wheelCount === 2 ? [t("setups.halves")] : [t("setups.halves"), t("setups.quarters")]}
                value={form.tireWidthMode}
                onChange={v => setForm(p => ({ ...p, tireWidthMode: v }))}
              />
              {form.tireWidthMode === "halves" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.front")}><NumberInput step="0.01" className="h-9" value={widthFront ?? ""} onChange={e => setWidthFront(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                  <Field label={t("setups.rear")}><NumberInput step="0.01" className="h-9" value={widthRear ?? ""} onChange={e => setWidthRear(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                </div>
              )}
              {form.tireWidthMode === "quarters" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.fl")}><NumberInput step="0.01" className="h-9" value={form.tireWidthFrontLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.fr")}><NumberInput step="0.01" className="h-9" value={form.tireWidthFrontRight ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.rl")}><NumberInput step="0.01" className="h-9" value={form.tireWidthRearLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.rr")}><NumberInput step="0.01" className="h-9" value={form.tireWidthRearRight ?? ""} onChange={e => setForm(p => ({ ...p, tireWidthRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                </div>
              )}
            </Section>

            {/* Tire Diameter */}
            <Section title={t("setups.tireDiameter", { unit: form.unitSystem })}>
              <ModeToggle
                options={wheelCount === 2 ? (["halves"] as const) : (["halves", "quarters"] as const)}
                labels={wheelCount === 2 ? [t("setups.halves")] : [t("setups.halves"), t("setups.quarters")]}
                value={form.tireDiameterMode}
                onChange={v => setForm(p => ({ ...p, tireDiameterMode: v }))}
              />
              {form.tireDiameterMode === "halves" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.front")}><NumberInput step="0.01" className="h-9" value={diamFront ?? ""} onChange={e => setDiamFront(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                  <Field label={t("setups.rear")}><NumberInput step="0.01" className="h-9" value={diamRear ?? ""} onChange={e => setDiamRear(e.target.value === "" ? null : parseFloat(e.target.value))} /></Field>
                </div>
              )}
              {form.tireDiameterMode === "quarters" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.fl")}><NumberInput step="0.01" className="h-9" value={form.tireDiameterFrontLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterFrontLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.fr")}><NumberInput step="0.01" className="h-9" value={form.tireDiameterFrontRight ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterFrontRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.rl")}><NumberInput step="0.01" className="h-9" value={form.tireDiameterRearLeft ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterRearLeft: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                  <Field label={t("setups.rr")}><NumberInput step="0.01" className="h-9" value={form.tireDiameterRearRight ?? ""} onChange={e => setForm(p => ({ ...p, tireDiameterRearRight: e.target.value === "" ? null : parseFloat(e.target.value) }))} /></Field>
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      {/* Bottom actions */}
      <div className="shrink-0 px-3 py-3 border-t border-border flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setMode("list"); }}>{t("setups.cancel")}</Button>
        <Button className="flex-1" disabled={!canSave} onClick={handleSave}>
          {mode === "edit" ? t("setups.update") : t("setups.save")}
        </Button>
      </div>

      {/* Copy-setup-from dialog */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("setups.copyFrom")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("setups.vehicle")}</Label>
              <Select value={copyVehicleId} onValueChange={handleCopyVehicleChange}>
                <SelectTrigger className="h-9"><SelectValue placeholder={t("setups.selectVehicle")} /></SelectTrigger>
                <SelectContent>
                  {copyableVehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("setups.setup")}</Label>
              <Select value={copySetupId} onValueChange={setCopySetupId} disabled={copyVehicleSetups.length === 0}>
                <SelectTrigger className="h-9"><SelectValue placeholder={t("setups.selectSetup")} /></SelectTrigger>
                <SelectContent>
                  {copyVehicleSetups.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>{t("setups.cancel")}</Button>
            <Button onClick={handleCopyConfirm} disabled={!copySetupId}>{t("setups.copy")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

