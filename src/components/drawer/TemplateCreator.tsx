import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SetupTemplate, TemplateSection } from "@/lib/templateStorage";
import { useTemplateFields } from "@/hooks/useTemplateFields";
import { cleanSections } from "@/lib/templateEdit";
import { TemplateFieldsEditor } from "@/components/drawer/TemplateFieldsEditor";

interface TemplateCreatorProps {
  existingTemplates: SetupTemplate[];
  existingTypeNames: string[];
  onSave: (name: string, wheelCount: 2 | 4, includeTires: boolean, sections: TemplateSection[]) => Promise<void>;
  onCancel: () => void;
}

export function TemplateCreator({ existingTemplates, existingTypeNames, onSave, onCancel }: TemplateCreatorProps) {
  const { t } = useTranslation("drawer");
  const fields = useTemplateFields();
  const { name, setName, wheelCount, includeTires, sections } = fields;
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [nameError, setNameError] = useState("");

  const handleCopyFrom = useCallback((templateId: string) => {
    setCopyFrom(templateId);
    const tpl = existingTemplates.find(tt => tt.id === templateId);
    if (tpl) fields.loadSections(tpl, { cloneIds: true });
  }, [existingTemplates, fields]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) { setNameError(t("templateCreator.nameRequired")); return; }
    if (existingTypeNames.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
      setNameError(t("templateCreator.nameExists"));
      return;
    }
    await onSave(trimmed, wheelCount, includeTires, cleanSections(sections));
  }, [name, wheelCount, includeTires, sections, existingTypeNames, onSave, t]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground flex-1">{t("templateCreator.title")}</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
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

        {/* Copy from */}
        <div className="space-y-1">
          <Label className="text-xs">{t("templateCreator.copyFrom")}</Label>
          <Select value={copyFrom} onValueChange={handleCopyFrom}>
            <SelectTrigger className="h-9"><SelectValue placeholder={t("templateCreator.startFromScratch")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("templateCreator.startFromScratch")}</SelectItem>
              {existingTemplates.map(tpl => (
                <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TemplateFieldsEditor {...fields} />
      </div>

      <div className="shrink-0 px-3 py-3 border-t border-border flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>{t("templateCreator.cancel")}</Button>
        <Button className="flex-1" onClick={handleSave} disabled={!name.trim()}>{t("templateCreator.create")}</Button>
      </div>
    </div>
  );
}
