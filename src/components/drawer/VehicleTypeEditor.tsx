import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VehicleType, SetupTemplate } from "@/lib/templateStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { useTemplateFields } from "@/hooks/useTemplateFields";
import {
  cleanSections, buildTemplateUpdate, findDestructiveChanges,
  revertDestructive, usedFieldIds, type DestructiveChange,
} from "@/lib/templateEdit";
import { TemplateFieldsEditor } from "@/components/drawer/TemplateFieldsEditor";

interface VehicleTypeEditorProps {
  vehicleTypes: VehicleType[];
  templates: SetupTemplate[];
  setups: VehicleSetup[];
  onUpdate: (vehicleType: VehicleType, template: SetupTemplate) => Promise<void>;
  onDone: () => void;
}

export function VehicleTypeEditor({ vehicleTypes, templates, setups, onUpdate, onDone }: VehicleTypeEditorProps) {
  const { t } = useTranslation("drawer");
  const fields = useTemplateFields();
  const { name, setName, wheelCount, includeTires, sections } = fields;

  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [originalTemplate, setOriginalTemplate] = useState<SetupTemplate | null>(null);
  const [highlightedFieldIds, setHighlightedFieldIds] = useState<Set<string>>(new Set());
  const [nameError, setNameError] = useState("");
  const [pending, setPending] = useState<{ cleaned: ReturnType<typeof cleanSections>; changes: DestructiveChange[] } | null>(null);

  const selectedType = useMemo(
    () => vehicleTypes.find(vt => vt.id === selectedTypeId) ?? null,
    [vehicleTypes, selectedTypeId],
  );

  // Field ids that existing setups actually hold data in — only these make an
  // edit destructive (an unused field can be removed/retyped freely).
  const used = useMemo(
    () => originalTemplate ? usedFieldIds(setups, originalTemplate.id) : new Set<string>(),
    [setups, originalTemplate],
  );

  const handleSelectType = useCallback((typeId: string) => {
    setSelectedTypeId(typeId);
    setNameError("");
    setHighlightedFieldIds(new Set());
    const vt = vehicleTypes.find(v => v.id === typeId);
    const tpl = vt ? templates.find(tt => tt.id === vt.templateId) : null;
    if (tpl) {
      setOriginalTemplate(tpl);
      fields.loadSections(tpl, { cloneIds: false });
      setName(tpl.name);
    } else {
      setOriginalTemplate(null);
    }
  }, [vehicleTypes, templates, fields, setName]);

  const doUpdate = useCallback(async (cleaned: ReturnType<typeof cleanSections>) => {
    if (!selectedType || !originalTemplate) return;
    const built = buildTemplateUpdate(selectedType, originalTemplate, {
      name: name.trim(), wheelCount, includeTires, sections: cleaned,
    });
    await onUpdate(built.vehicleType, built.template);
    onDone();
  }, [selectedType, originalTemplate, name, wheelCount, includeTires, onUpdate, onDone]);

  const handleUpdate = useCallback(async () => {
    if (!selectedType || !originalTemplate) return;
    const trimmed = name.trim();
    if (!trimmed) { setNameError(t("templateCreator.nameRequired")); return; }
    const clash = vehicleTypes.some(vt => vt.id !== selectedType.id && vt.name.toLowerCase() === trimmed.toLowerCase());
    if (clash) { setNameError(t("templateCreator.nameExists")); return; }

    const cleaned = cleanSections(sections);
    const changes = findDestructiveChanges(originalTemplate.sections, cleaned, used);
    if (changes.length > 0) {
      setPending({ cleaned, changes });
      return;
    }
    await doUpdate(cleaned);
  }, [selectedType, originalTemplate, name, sections, used, vehicleTypes, t, doUpdate]);

  const handleConfirmDestructive = useCallback(async () => {
    if (!pending) return;
    const { cleaned } = pending;
    setPending(null);
    await doUpdate(cleaned);
  }, [pending, doUpdate]);

  // Cancel the warning: stomp the destructive edits back to their original
  // definitions (re-add removed fields, reset flipped types) and flag them
  // orange so the user sees what was rolled back. Stays in the editor.
  const handleCancelDestructive = useCallback(() => {
    if (!pending || !originalTemplate) return;
    const { sections: reverted, restoredIds } = revertDestructive(originalTemplate.sections, sections, pending.changes);
    fields.setSections(reverted);
    setHighlightedFieldIds(restoredIds);
    setPending(null);
  }, [pending, originalTemplate, sections, fields]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDone}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground flex-1">{t("vehicleTypeEditor.title")}</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Vehicle type picker — starts empty so editing is a deliberate choice. */}
        <div className="space-y-1">
          <Label className="text-xs">{t("vehicleTypeEditor.selectType")}</Label>
          <Select value={selectedTypeId} onValueChange={handleSelectType}>
            <SelectTrigger className="h-9"><SelectValue placeholder={t("vehicleTypeEditor.selectTypePlaceholder")} /></SelectTrigger>
            <SelectContent>
              {vehicleTypes.map(vt => (
                <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!selectedType ? (
          <p className="text-xs text-muted-foreground px-1 py-8 text-center">{t("vehicleTypeEditor.pickPrompt")}</p>
        ) : (
          <>
            {/* Name */}
            <div className="space-y-1">
              <Label className="text-xs">{t("templateCreator.vehicleTypeName")}</Label>
              <Input
                value={name}
                onChange={e => { setName(e.target.value); setNameError(""); }}
                placeholder={t("templateCreator.vehicleTypeNamePlaceholder")}
                className={`h-9 ${nameError ? "border-destructive" : ""}`}
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>

            <TemplateFieldsEditor {...fields} highlightedFieldIds={highlightedFieldIds} />
          </>
        )}
      </div>

      <div className="shrink-0 px-3 py-3 border-t border-border flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onDone}>{t("templateCreator.cancel")}</Button>
        <Button className="flex-1" onClick={handleUpdate} disabled={!selectedType || !name.trim()}>{t("vehicleTypeEditor.update")}</Button>
      </div>

      {/* Destructive-change warning */}
      <Dialog open={!!pending} onOpenChange={open => { if (!open) handleCancelDestructive(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" /> {t("vehicleTypeEditor.warningTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("vehicleTypeEditor.warningBody")}</p>
            <ul className="space-y-1 text-sm">
              {pending?.changes.map(c => (
                <li key={c.field.id} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
                  <span>
                    <span className="font-medium text-foreground">{c.field.name}</span>{" "}
                    <span className="text-muted-foreground">
                      {c.reason === "removed" ? t("vehicleTypeEditor.warningRemoved") : t("vehicleTypeEditor.warningTypeChanged")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDestructive}>{t("vehicleTypeEditor.warningCancel")}</Button>
            <Button variant="destructive" onClick={handleConfirmDestructive}>{t("vehicleTypeEditor.warningConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
