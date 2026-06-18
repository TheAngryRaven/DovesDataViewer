import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Eye, EyeOff, Gauge, Activity, Circle, HardDrive, Languages, Sun, Moon, RefreshCw, Timer, Ruler, ChevronDown, Map, CloudSun } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AppSettings } from "@/hooks/useSettings";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/i18n/config";
import { FIELD_CATEGORIES, CanonicalFieldId } from "@/lib/fieldResolver";
import { cn } from "@/lib/utils";

interface SettingsModalProps {
  settings: AppSettings;
  onSettingsChange: (updates: Partial<AppSettings>) => void;
  onToggleFieldDefault: (canonicalId: CanonicalFieldId) => void;
  /** False when the sample is the user's only file — the toggle is then locked on. */
  canHideSampleFiles: boolean;
}

export function SettingsModal({
  settings,
  onSettingsChange,
  onToggleFieldDefault,
  canHideSampleFiles,
}: SettingsModalProps) {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 lg:px-3">
          <Settings className="w-4 h-4" />
          <span className="hidden lg:inline">{t("settings:title")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            {t("settings:title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4 overflow-y-auto flex-1 min-h-0 pr-3 scrollbar-thin">
          {/* Compact toggle settings — responsive 2-column grid on tablet+ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
          {/* Language */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("common:language.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-language" className="text-sm text-muted-foreground">
                {t("common:language.label")}
              </Label>
              <Select
                value={settings.language}
                onValueChange={(value) => onSettingsChange({ language: value as SupportedLanguage })}
              >
                <SelectTrigger id="settings-language" className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.nativeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Theme Toggle */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {settings.darkMode ? <Moon className="w-4 h-4 text-muted-foreground" /> : <Sun className="w-4 h-4 text-muted-foreground" />}
              <h3 className="font-medium">{t("settings:theme.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-dark-mode" className="text-sm text-muted-foreground">
                {t("settings:theme.darkMode")}
              </Label>
              <div className="flex items-center gap-2">
                <Sun className={`w-3.5 h-3.5 ${!settings.darkMode ? "text-foreground" : "text-muted-foreground"}`} />
                <Switch
                  id="settings-dark-mode"
                  checked={settings.darkMode}
                  onCheckedChange={(checked) => onSettingsChange({ darkMode: checked })}
                />
                <Moon className={`w-3.5 h-3.5 ${settings.darkMode ? "text-foreground" : "text-muted-foreground"}`} />
              </div>
            </div>
          </div>

          {/* Auto-Save Files */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:fileStorage.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-auto-save" className="text-sm text-muted-foreground">
                  {t("settings:fileStorage.autoSave")}
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {t("settings:fileStorage.autoSaveHint")}
                </p>
              </div>
              <Switch
                id="settings-auto-save"
                checked={settings.autoSaveFiles}
                onCheckedChange={(checked) => onSettingsChange({ autoSaveFiles: checked })}
              />
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-show-samples" className="text-sm text-muted-foreground">
                  {t("settings:fileStorage.showSamples")}
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {canHideSampleFiles
                    ? t("settings:fileStorage.showSamplesHint")
                    : t("settings:fileStorage.showSamplesLocked")}
                </p>
              </div>
              <Switch
                id="settings-show-samples"
                // Locked on when the sample is the only file, so it can't be
                // hidden away leaving the user with nothing to open.
                checked={canHideSampleFiles ? settings.showSampleFiles : true}
                disabled={!canHideSampleFiles}
                onCheckedChange={(checked) => onSettingsChange({ showSampleFiles: checked })}
              />
            </div>
          </div>

          {/* Speed Unit */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:speedUnit.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-speed-unit" className="text-sm text-muted-foreground">
                {t("settings:speedUnit.label")}
              </Label>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${!settings.useKph ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  MPH
                </span>
                <Switch
                  id="settings-speed-unit"
                  checked={settings.useKph}
                  onCheckedChange={(checked) => onSettingsChange({ useKph: checked })}
                />
                <span className={`text-xs ${settings.useKph ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  KPH
                </span>
              </div>
            </div>
          </div>

          {/* Distance Unit */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Map className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:distanceUnit.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-distance-unit" className="text-sm text-muted-foreground">
                {t("settings:distanceUnit.label")}
              </Label>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${!settings.useMetricDistance ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  ft/mi
                </span>
                <Switch
                  id="settings-distance-unit"
                  checked={settings.useMetricDistance}
                  onCheckedChange={(checked) => onSettingsChange({ useMetricDistance: checked })}
                />
                <span className={`text-xs ${settings.useMetricDistance ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  m/km
                </span>
              </div>
            </div>
          </div>

          {/* Weather Units */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CloudSun className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:weatherUnits.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-weather-units" className="text-sm text-muted-foreground">
                  {t("settings:weatherUnits.label")}
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {t("settings:weatherUnits.hint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${!settings.useMetricWeather ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {t("settings:weatherUnits.imperialShort")}
                </span>
                <Switch
                  id="settings-weather-units"
                  checked={settings.useMetricWeather}
                  onCheckedChange={(checked) => onSettingsChange({ useMetricWeather: checked })}
                />
                <span className={`text-xs ${settings.useMetricWeather ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {t("settings:weatherUnits.metricShort")}
                </span>
              </div>
            </div>
          </div>

          {/* G-Force Smoothing */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:gforceSmoothing.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-gforce-smoothing" className="text-sm text-muted-foreground">
                {t("settings:gforceSmoothing.label")}
              </Label>
              <Switch
                id="settings-gforce-smoothing"
                checked={settings.gForceSmoothing}
                onCheckedChange={(checked) => onSettingsChange({ gForceSmoothing: checked })}
              />
            </div>
            {settings.gForceSmoothing && (
              <div className="pl-6 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-muted-foreground">{t("settings:gforceSmoothing.strength")}</Label>
                  <span className="text-xs font-mono text-muted-foreground">
                    {settings.gForceSmoothingStrength}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{t("settings:gforceSmoothing.none")}</span>
                  <Slider
                    value={[settings.gForceSmoothingStrength]}
                    onValueChange={([value]) => onSettingsChange({ gForceSmoothingStrength: value })}
                    min={0}
                    max={100}
                    step={5}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground">{t("settings:gforceSmoothing.max")}</span>
                </div>
              </div>
            )}
          </div>

          {/* G-Force Source for Simple Mode */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:gforceSource.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-gforce-source" className="text-sm text-muted-foreground">
                  {t("settings:gforceSource.label")}
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {t("settings:gforceSource.hint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${settings.gForceSource === 'gps' ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  GPS
                </span>
                <Switch
                  id="settings-gforce-source"
                  checked={settings.gForceSource === 'hw'}
                  onCheckedChange={(checked) => onSettingsChange({ gForceSource: checked ? 'hw' : 'gps' })}
                />
                <span className={`text-xs ${settings.gForceSource === 'hw' ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  HW
                </span>
              </div>
            </div>
          </div>

          {/* Lap Delta Method */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:lapDelta.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-delta-method" className="text-sm text-muted-foreground">
                  {t("settings:lapDelta.label")}
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {t("settings:lapDelta.hint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${settings.deltaMethod === 'distance' ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {t("settings:lapDelta.distance")}
                </span>
                <Switch
                  id="settings-delta-method"
                  checked={settings.deltaMethod === 'position'}
                  onCheckedChange={(checked) => onSettingsChange({ deltaMethod: checked ? 'position' : 'distance' })}
                />
                <span className={`text-xs ${settings.deltaMethod === 'position' ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {t("settings:lapDelta.position")}
                </span>
              </div>
            </div>
          </div>

          {/* Chart X-Axis Scale */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Ruler className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">{t("settings:chartScale.heading")}</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-chart-xaxis" className="text-sm text-muted-foreground">
                  {t("settings:chartScale.label")}
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {t("settings:chartScale.hint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${settings.chartXAxis === 'time' ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {t("settings:chartScale.time")}
                </span>
                <Switch
                  id="settings-chart-xaxis"
                  checked={settings.chartXAxis === 'distance'}
                  onCheckedChange={(checked) => onSettingsChange({ chartXAxis: checked ? 'distance' : 'time' })}
                />
                <span className={`text-xs ${settings.chartXAxis === 'distance' ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {t("settings:chartScale.distance")}
                </span>
              </div>
            </div>
          </div>

          </div>

          {/* Braking Zone Detection — collapsible, full width */}
          <CollapsibleSection
            icon={<Circle className="w-4 h-4 text-primary" />}
            title={t("settings:braking.heading")}
            badge={<span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t("settings:braking.experimental")}</span>}
          >
            <p className="text-xs text-muted-foreground pl-6">
              {t("settings:braking.intro")}
            </p>

            {/* Entry Threshold */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.entryThreshold")}</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  -{(settings.brakingEntryThreshold / 100).toFixed(2)}g
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">-0.10g</span>
                <Slider
                  value={[settings.brakingEntryThreshold]}
                  onValueChange={([value]) => onSettingsChange({ brakingEntryThreshold: value })}
                  min={10}
                  max={50}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">-0.50g</span>
              </div>
            </div>

            {/* Exit Threshold */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.exitThreshold")}</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  -{(settings.brakingExitThreshold / 100).toFixed(2)}g
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">-0.05g</span>
                <Slider
                  value={[settings.brakingExitThreshold]}
                  onValueChange={([value]) => onSettingsChange({ brakingExitThreshold: value })}
                  min={5}
                  max={25}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">-0.25g</span>
              </div>
            </div>

            {/* Min Duration */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.minDuration")}</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {settings.brakingMinDuration}ms
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">50ms</span>
                <Slider
                  value={[settings.brakingMinDuration]}
                  onValueChange={([value]) => onSettingsChange({ brakingMinDuration: value })}
                  min={50}
                  max={500}
                  step={10}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">500ms</span>
              </div>
            </div>

            {/* Smoothing Alpha */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.smoothing")}</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {(settings.brakingSmoothingAlpha / 100).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">0.10</span>
                <Slider
                  value={[settings.brakingSmoothingAlpha]}
                  onValueChange={([value]) => onSettingsChange({ brakingSmoothingAlpha: value })}
                  min={10}
                  max={80}
                  step={5}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">0.80</span>
              </div>
            </div>

            {/* Zone Width */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.zoneWidth")}</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {settings.brakingZoneWidth}px
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">6px</span>
                <Slider
                  value={[settings.brakingZoneWidth]}
                  onValueChange={([value]) => onSettingsChange({ brakingZoneWidth: value })}
                  min={6}
                  max={16}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">16px</span>
              </div>
            </div>

            {/* Graph Smoothing Window */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.graphSmoothing")}</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {t("settings:braking.graphSmoothingUnit", { count: settings.brakingGraphWindow })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground/70">
                {t("settings:braking.graphSmoothingHint")}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">5</span>
                <Slider
                  value={[settings.brakingGraphWindow]}
                  onValueChange={([value]) => {
                    const odd = value % 2 === 0 ? value + 1 : value;
                    onSettingsChange({ brakingGraphWindow: odd });
                  }}
                  min={5}
                  max={51}
                  step={2}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">51</span>
              </div>
            </div>

            {/* Brake Max G (100% calibration) */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.brakeMaxLabel")}</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {((settings.brakeMaxG ?? 150) / 100).toFixed(2)}G
                </span>
              </div>
              <p className="text-xs text-muted-foreground/70">
                {t("settings:braking.brakeMaxHint")}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">0.5G</span>
                <Slider
                  value={[settings.brakeMaxG ?? 150]}
                  onValueChange={([value]) => onSettingsChange({ brakeMaxG: value })}
                  min={50}
                  max={300}
                  step={5}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">3.0G</span>
              </div>
            </div>

            {/* Zone Color */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{t("settings:braking.zoneColor")}</Label>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { color: 'hsl(210, 90%, 55%)', label: t("settings:braking.colors.blue") },
                  { color: 'hsl(30, 90%, 50%)', label: t("settings:braking.colors.orange") },
                  { color: 'hsl(280, 70%, 55%)', label: t("settings:braking.colors.purple") },
                  { color: 'hsl(340, 80%, 55%)', label: t("settings:braking.colors.pink") },
                  { color: 'hsl(180, 70%, 50%)', label: t("settings:braking.colors.cyan") },
                  { color: 'hsl(60, 80%, 50%)', label: t("settings:braking.colors.yellow") },
                ].map(({ color, label }) => (
                  <button
                    key={color}
                    onClick={() => onSettingsChange({ brakingZoneColor: color })}
                    className={`w-8 h-8 rounded-md border-2 transition-all ${
                      settings.brakingZoneColor === color 
                        ? 'border-foreground scale-110' 
                        : 'border-transparent hover:border-muted-foreground/50'
                    }`}
                    style={{ backgroundColor: color }}
                    title={label}
                  />
                ))}
             </div>
            </div>

            {/* Reset Button */}
            <div className="pl-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSettingsChange({
                  brakingEntryThreshold: 25,
                  brakingExitThreshold: 10,
                  brakingMinDuration: 120,
                  brakingSmoothingAlpha: 40,
                  brakingZoneColor: 'hsl(210, 90%, 55%)',
                  brakingZoneWidth: 10,
                  brakingGraphWindow: 25,
                  brakeMaxG: 150,
                })}
                className="gap-2 text-xs"
              >
                <RefreshCw className="w-3 h-3" />
                {t("common:actions.reset")}
              </Button>
            </div>
          </CollapsibleSection>

          {/* Default Field Visibility — collapsible, full width */}
          <CollapsibleSection
            icon={<Eye className="w-4 h-4 text-primary" />}
            title={t("settings:fieldVisibility.heading")}
          >
            <p className="text-xs text-muted-foreground pl-6">
              {t("settings:fieldVisibility.intro")}
            </p>
            
            {FIELD_CATEGORIES.map((category) => (
              <div key={category.category} className="space-y-2 pl-6">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {category.category}
                  </span>
                  <span className="text-xs text-muted-foreground/60">— {category.description}</span>
                </div>
                <div className="space-y-1">
                  {category.fields.map((field) => {
                    const isHidden = settings.defaultHiddenFields.includes(field.canonicalId);
                    return (
                      <button
                        key={field.canonicalId}
                        onClick={() => onToggleFieldDefault(field.canonicalId)}
                        className={`w-full flex items-center justify-between p-2 rounded-md transition-colors ${
                          isHidden
                            ? "bg-muted/50 text-muted-foreground"
                            : "bg-primary/10 text-foreground"
                        } hover:bg-muted`}
                      >
                        <div className="flex items-center gap-3">
                          {isHidden ? (
                            <EyeOff className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <Eye className="w-4 h-4 text-primary" />
                          )}
                          <div className="text-left">
                            <div className="text-sm font-medium">{field.label}</div>
                            <div className="text-xs text-muted-foreground">{field.description}</div>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded ${isHidden ? "bg-muted text-muted-foreground" : "bg-primary/20 text-primary"}`}>
                          {isHidden ? t("settings:fieldVisibility.hidden") : t("settings:fieldVisibility.visible")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </CollapsibleSection>

          <Separator />

          {/* Force Update */}
          <ForceUpdateSection />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({ icon, title, badge, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-medium text-foreground"
      >
        {icon}
        <h3 className="font-medium">{title}</h3>
        {badge}
        <ChevronDown className={cn("w-4 h-4 transition-transform ml-auto", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function ForceUpdateSection() {
  const { t } = useTranslation(["settings", "common"]);
  const [updating, setUpdating] = useState(false);

  const handleForceUpdate = async () => {
    setUpdating(true);
    try {
      // Unregister all service workers
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }

      // Clear all caches
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }

      // Hard reload
      window.location.reload();
    } catch (e) {
      console.error("Force update failed:", e);
      // Reload anyway
      window.location.reload();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <RefreshCw className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-medium">{t("settings:appUpdate.heading")}</h3>
      </div>
      <div className="flex items-center justify-between pl-6">
        <div>
          <Label htmlFor="force-update" className="text-sm text-muted-foreground">
            {t("settings:appUpdate.label")}
          </Label>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            {t("settings:appUpdate.hint")}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleForceUpdate}
          disabled={updating}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${updating ? "animate-spin" : ""}`} />
          {updating ? t("common:actions.updating") : t("common:actions.update")}
        </Button>
      </div>
    </div>
  );
}
