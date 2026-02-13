import { Settings, Eye, EyeOff, Gauge, Activity, Circle, HardDrive, FlaskConical } from "lucide-react";
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
                Savitzky-Golay filter window for the Braking G chart. Larger = smoother.
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">5</span>
                <Slider
                  value={[settings.brakingGraphWindow]}
                  onValueChange={([value]) => {
                    // Ensure odd
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
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">Super Experimental Features</h3>
            </div>
            <div className="flex items-center justify-between pl-6">
              <div>
                <Label htmlFor="settings-enable-labs" className="text-sm text-muted-foreground">
                  Enable Labs mode
                </Label>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  shhhhhh!
                </p>
              </div>
              <Switch
                id="settings-enable-labs"
                checked={settings.enableLabs}
                onCheckedChange={(checked) => onSettingsChange({ enableLabs: checked })}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
