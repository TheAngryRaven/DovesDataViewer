import { useState } from "react";
import { Settings, Eye, EyeOff, Gauge, Activity, Circle, HardDrive, FlaskConical, Sun, Moon, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AppSettings } from "@/hooks/useSettings";
import { FIELD_CATEGORIES, CanonicalFieldId } from "@/lib/fieldResolver";

interface SettingsModalProps {
  settings: AppSettings;
  onSettingsChange: (updates: Partial<AppSettings>) => void;
  onToggleFieldDefault: (canonicalId: CanonicalFieldId) => void;
}

export function SettingsModal({
  settings,
  onSettingsChange,
  onToggleFieldDefault,
}: SettingsModalProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <Settings className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4 overflow-y-auto flex-1 min-h-0 pr-3 scrollbar-thin">
          {/* Theme Toggle */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {settings.darkMode ? <Moon className="w-4 h-4 text-muted-foreground" /> : <Sun className="w-4 h-4 text-muted-foreground" />}
              <h3 className="font-medium">Theme</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-dark-mode" className="text-sm text-muted-foreground">
                Dark mode
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

          <Separator />

          {/* Auto-Save Files */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">File Storage</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-auto-save" className="text-sm text-muted-foreground">
                  Auto-save imported/uploaded files to device
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  Automatically store files in on-device storage for later access
                </p>
              </div>
              <Switch
                id="settings-auto-save"
                checked={settings.autoSaveFiles}
                onCheckedChange={(checked) => onSettingsChange({ autoSaveFiles: checked })}
              />
            </div>
          </div>

          <Separator />

          {/* Speed Unit */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">Speed Unit</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-speed-unit" className="text-sm text-muted-foreground">
                Display speed in kilometers per hour
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

          {/* G-Force Smoothing */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">G-Force Smoothing</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <Label htmlFor="settings-gforce-smoothing" className="text-sm text-muted-foreground">
                Apply noise reduction to calculated G-forces
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
                  <Label className="text-sm text-muted-foreground">Smoothing Strength</Label>
                  <span className="text-xs font-mono text-muted-foreground">
                    {settings.gForceSmoothingStrength}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">None</span>
                  <Slider
                    value={[settings.gForceSmoothingStrength]}
                    onValueChange={([value]) => onSettingsChange({ gForceSmoothingStrength: value })}
                    min={0}
                    max={100}
                    step={5}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground">Max</span>
                </div>
              </div>
            )}
          </div>

          {/* G-Force Source for Simple Mode */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">G-Force Source</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-gforce-source" className="text-sm text-muted-foreground">
                  G-force data source for simple chart
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  GPS = derived from speed/heading, HW = hardware accelerometer
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

          {/* Braking Zone Detection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Circle className="w-4 h-4 text-blue-500" />
              <h3 className="font-medium">Braking Zone Detection</h3>
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Experimental</span>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Tune the detection algorithm for identifying braking zones on the map.
            </p>
            
            {/* Entry Threshold */}
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Entry Threshold</Label>
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
                <Label className="text-sm text-muted-foreground">Exit Threshold</Label>
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
                <Label className="text-sm text-muted-foreground">Min Duration</Label>
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
                <Label className="text-sm text-muted-foreground">Smoothing</Label>
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
                <Label className="text-sm text-muted-foreground">Zone Width</Label>
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
                <Label className="text-sm text-muted-foreground">Graph Smoothing</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {settings.brakingGraphWindow} pts
                </span>
              </div>
              <p className="text-xs text-muted-foreground/70">
                Savitzky-Golay filter window for the Brake % chart. Larger = smoother.
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
                <Label className="text-sm text-muted-foreground">Brake 100% = </Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {((settings.brakeMaxG ?? 150) / 100).toFixed(2)}G
                </span>
              </div>
              <p className="text-xs text-muted-foreground/70">
                The deceleration G-force that maps to 100% brake. Lower = more sensitive.
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
                <Label className="text-sm text-muted-foreground">Zone Color</Label>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { color: 'hsl(210, 90%, 55%)', label: 'Blue' },
                  { color: 'hsl(30, 90%, 50%)', label: 'Orange' },
                  { color: 'hsl(280, 70%, 55%)', label: 'Purple' },
                  { color: 'hsl(340, 80%, 55%)', label: 'Pink' },
                  { color: 'hsl(180, 70%, 50%)', label: 'Cyan' },
                  { color: 'hsl(60, 80%, 50%)', label: 'Yellow' },
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
          </div>

          <Separator />

          {/* Default Field Visibility */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">Default Field Visibility</h3>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Choose which data fields are visible by default when loading a file. Hidden fields can still be enabled manually.
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
                          {isHidden ? "Hidden" : "Visible"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <Separator />

          {/* Super Experimental Features */}
          {/* Labs toggle hidden — no active labs features */}

          {/* Force Update */}
          <ForceUpdateSection />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ForceUpdateSection() {
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
        <h3 className="font-medium">App Update</h3>
      </div>
      <div className="flex items-center justify-between pl-6">
        <div>
          <Label htmlFor="force-update" className="text-sm text-muted-foreground">
            Force update &amp; clear cache
          </Label>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Clears cached app files and reloads the latest version. Your saved sessions and data in the Garage are not affected.
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
          {updating ? "Updating…" : "Update"}
        </Button>
      </div>
    </div>
  );
}
