import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TemplateSection, TemplateFieldDef } from "@/lib/templateStorage";

interface TemplateFieldsEditorProps {
  wheelCount: 2 | 4;
  setWheelCount: (n: 2 | 4) => void;
  includeTires: boolean;
  setIncludeTires: (v: boolean) => void;
  sections: TemplateSection[];
  addSection: () => void;
  removeSection: (secId: string) => void;
  updateSection: (secId: string, update: Partial<TemplateSection>) => void;
  addField: (secId: string) => void;
  removeField: (secId: string, fieldId: string) => void;
  updateField: (secId: string, fieldId: string, update: Partial<TemplateFieldDef>) => void;
  /** Field ids to flag in orange (e.g. restored after a cancelled destructive edit). */
  highlightedFieldIds?: Set<string>;
}

/**
 * Presentational wheel-config + tires + sections/fields editor. Shared by the
 * vehicle-type creator and editor; owns no state of its own.
 */
export function TemplateFieldsEditor({
  wheelCount, setWheelCount, includeTires, setIncludeTires,
  sections, addSection, removeSection, updateSection, addField, removeField, updateField,
  highlightedFieldIds,
}: TemplateFieldsEditorProps) {
  const { t } = useTranslation("drawer");

  return (
    <>
      {/* Wheel count */}
      <div className="space-y-1">
        <Label className="text-xs">{t("templateCreator.wheelConfig")}</Label>
        <div className="flex gap-1 bg-muted/50 rounded-md p-0.5">
          <button type="button" onClick={() => setWheelCount(2)} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${wheelCount === 2 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t("templateCreator.wheels2")}</button>
          <button type="button" onClick={() => setWheelCount(4)} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${wheelCount === 4 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t("templateCreator.wheels4")}</button>
        </div>
      </div>

      {/* Include tires */}
      <div className="flex items-center justify-between">
        <Label className="text-xs">{t("templateCreator.includeTires")}</Label>
        <Switch checked={includeTires} onCheckedChange={setIncludeTires} className="scale-90" />
      </div>

      {/* Sections */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("templateCreator.setupSections")}</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {sections.map(section => (
          <div key={section.id} className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
            <div className="flex items-center gap-2">
              <Input
                value={section.name}
                onChange={e => updateSection(section.id, { name: e.target.value })}
                placeholder={t("templateCreator.sectionNamePlaceholder")}
                className="h-8 text-sm flex-1"
              />
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0" onClick={() => removeSection(section.id)} disabled={sections.length <= 1}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            {section.fields.map(field => {
              const highlighted = highlightedFieldIds?.has(field.id);
              return (
                <div key={field.id} className={`flex items-start gap-2 pl-2 border-l-2 rounded-r-sm ${highlighted ? "border-warning bg-warning/10" : "border-border"}`}>
                  <div className="flex-1 space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={field.name}
                        onChange={e => updateField(section.id, field.id, { name: e.target.value })}
                        placeholder={t("templateCreator.fieldName")}
                        className="h-8 text-sm"
                      />
                      <Select
                        value={field.type}
                        onValueChange={v => updateField(section.id, field.id, { type: v as "number" | "string" })}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="number">{t("templateCreator.number")}</SelectItem>
                          <SelectItem value="string">{t("templateCreator.text")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-0.5">
                        <Label className="text-[10px] text-muted-foreground">{t("templateCreator.unit")}</Label>
                        <Input
                          value={field.unit ?? ""}
                          onChange={e => updateField(section.id, field.id, { unit: e.target.value || undefined })}
                          placeholder={t("templateCreator.unitPlaceholder")}
                          className="h-7 text-xs"
                        />
                      </div>
                      {field.type === "number" && (
                        <>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground">{t("templateCreator.min")}</Label>
                            <Input
                              type="number"
                              value={field.min ?? ""}
                              onChange={e => updateField(section.id, field.id, { min: e.target.value === "" ? undefined : Number(e.target.value) })}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground">{t("templateCreator.max")}</Label>
                            <Input
                              type="number"
                              value={field.max ?? ""}
                              onChange={e => updateField(section.id, field.id, { max: e.target.value === "" ? undefined : Number(e.target.value) })}
                              className="h-7 text-xs"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0 mt-0.5" onClick={() => removeField(section.id, field.id)} disabled={section.fields.length <= 1}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              );
            })}

            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => addField(section.id)}>
              <Plus className="w-3 h-3" /> {t("templateCreator.addField")}
            </Button>
          </div>
        ))}

        <Button variant="outline" size="sm" className="w-full gap-1" onClick={addSection}>
          <Plus className="w-3.5 h-3.5" /> {t("templateCreator.addSection")}
        </Button>
      </div>
    </>
  );
}
