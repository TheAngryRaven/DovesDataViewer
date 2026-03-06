import { useState, useCallback, useMemo } from "react";
import { Plus, Trash2, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import type { OverlayInstance, OverlaySettings, OverlayType, ThemeId, DataSourceDef } from "./types";
import { OVERLAY_TYPES, getOverlayTypeDef, generateOverlayId } from "./registry";
import { THEMES } from "./themes";

interface OverlaySettingsPanelProps {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  dataSources: DataSourceDef[];
  hasReference: boolean;
  hasSectors: boolean;
}

export function OverlaySettingsPanel({ settings, onUpdate, dataSources, hasReference, hasSectors }: OverlaySettingsPanelProps) {
  const safeSettings: OverlaySettings = {
    overlaysLocked: settings?.overlaysLocked ?? true,
    overlays: settings?.overlays ?? [],
  };
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addType, setAddType] = useState<OverlayType | "">("");

  const availableTypes = useMemo(() => {
    return OVERLAY_TYPES.filter(t => {
      if (t.type === "pace" && !hasReference) return false;
      if (t.type === "sector" && !hasSectors) return false;
      return true;
    });
  }, [hasReference, hasSectors]);

  const handleAdd = useCallback(() => {
    if (!addType) return;
    const typeDef = getOverlayTypeDef(addType as OverlayType);
    if (!typeDef) return;

    const defaultSource = typeDef.isSpecial
      ? (addType === "pace" ? "__pace__" : addType === "sector" ? "__sector__" : "__map__")
      : (dataSources[0]?.id ?? "speed");

    const newOverlay: OverlayInstance = {
      id: generateOverlayId(),
      type: addType as OverlayType,
      dataSource: defaultSource,
      theme: "classic",
      colorMode: "dark",
      opacity: 1,
      position: { x: 5, y: 5 + safeSettings.overlays.length * 12 },
      visible: true,
      ...(typeDef.defaultConfig as Partial<OverlayInstance>),
    };

    onUpdate({ ...safeSettings, overlays: [...safeSettings.overlays, newOverlay] });
    setAddType("");
    setExpandedId(newOverlay.id);
  }, [addType, settings, onUpdate, dataSources]);

  const updateOverlay = useCallback((id: string, patch: Partial<OverlayInstance>) => {
    onUpdate({
      ...settings,
      overlays: settings.overlays.map(o => o.id === id ? { ...o, ...patch } : o),
    });
  }, [settings, onUpdate]);

  const removeOverlay = useCallback((id: string) => {
    onUpdate({
      ...settings,
      overlays: settings.overlays.filter(o => o.id !== id),
    });
  }, [settings, onUpdate]);

  return (
    <div className="space-y-4">
      {/* Add overlay section */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Add Overlay</h3>
        <div className="flex gap-2">
          <Select value={addType} onValueChange={(v) => setAddType(v as OverlayType)}>
            <SelectTrigger className="flex-1 h-8 text-sm">
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              {availableTypes.map(t => (
                <SelectItem key={t.type} value={t.type}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1" onClick={handleAdd} disabled={!addType}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Overlay list */}
      {settings.overlays.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No overlays configured. Add one above.</p>
      ) : (
        <div className="space-y-1">
          {settings.overlays.map(overlay => {
            const typeDef = getOverlayTypeDef(overlay.type);
            const isExpanded = expandedId === overlay.id;

            return (
              <div key={overlay.id} className="border border-border rounded-md overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
                  <button onClick={() => setExpandedId(isExpanded ? null : overlay.id)} className="flex-1 flex items-center gap-2 text-left">
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="text-sm font-medium">{typeDef?.label ?? overlay.type}</span>
                    {!typeDef?.isSpecial && (
                      <span className="text-xs text-muted-foreground">
                        — {dataSources.find(d => d.id === overlay.dataSource)?.label ?? overlay.dataSource}
                      </span>
                    )}
                  </button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateOverlay(overlay.id, { visible: !overlay.visible })}>
                    {overlay.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeOverlay(overlay.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Expanded config */}
                {isExpanded && (
                  <div className="px-3 py-3 space-y-3 border-t border-border">
                    {/* Data source */}
                    {!typeDef?.isSpecial && (
                      <div className="space-y-1">
                        <Label className="text-xs">Data Source</Label>
                        <Select value={overlay.dataSource} onValueChange={(v) => updateOverlay(overlay.id, { dataSource: v })}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {dataSources.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Secondary source for bubble */}
                    {typeDef?.needsSecondarySource && (
                      <div className="space-y-1">
                        <Label className="text-xs">Secondary Source (Y axis)</Label>
                        <Select value={overlay.dataSourceSecondary ?? ""} onValueChange={(v) => updateOverlay(overlay.id, { dataSourceSecondary: v })}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Same as primary" />
                          </SelectTrigger>
                          <SelectContent>
                            {dataSources.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Theme */}
                    <div className="flex gap-4">
                      <div className="space-y-1 flex-1">
                        <Label className="text-xs">Theme</Label>
                        <Select value={overlay.theme} onValueChange={(v) => updateOverlay(overlay.id, { theme: v as ThemeId })}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.values(THEMES).map(t => (
                              <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Mode</Label>
                        <div className="flex items-center gap-2 h-8">
                          <span className="text-xs text-muted-foreground">Light</span>
                          <Switch
                            checked={overlay.colorMode === "dark"}
                            onCheckedChange={(v) => updateOverlay(overlay.id, { colorMode: v ? "dark" : "light" })}
                          />
                          <span className="text-xs text-muted-foreground">Dark</span>
                        </div>
                      </div>
                    </div>

                    {/* Opacity */}
                    <div className="space-y-1">
                      <Label className="text-xs">Opacity ({Math.round(overlay.opacity * 100)}%)</Label>
                      <Slider
                        value={[overlay.opacity]}
                        onValueChange={([v]) => updateOverlay(overlay.id, { opacity: v })}
                        min={0.1}
                        max={1}
                        step={0.05}
                        className="w-full"
                      />
                    </div>

                    {/* Type-specific config */}
                    {(overlay.type === "graph" || overlay.type === "bar") && (
                      <div className="space-y-1">
                        <Label className="text-xs">Color</Label>
                        <Input
                          type="color"
                          value={overlay.color ?? "#00ccaa"}
                          onChange={(e) => updateOverlay(overlay.id, { color: e.target.value })}
                          className="h-8 w-16 p-1 cursor-pointer"
                        />
                      </div>
                    )}

                    {overlay.type === "graph" && (
                      <div className="space-y-1">
                        <Label className="text-xs">History Length ({overlay.graphLength ?? 100} samples)</Label>
                        <Slider
                          value={[overlay.graphLength ?? 100]}
                          onValueChange={([v]) => updateOverlay(overlay.id, { graphLength: v })}
                          min={20}
                          max={500}
                          step={10}
                          className="w-full"
                        />
                      </div>
                    )}

                    {overlay.type === "sector" && (
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Animations</Label>
                        <Switch
                          checked={overlay.showAnimation !== false}
                          onCheckedChange={(v) => updateOverlay(overlay.id, { showAnimation: v })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
