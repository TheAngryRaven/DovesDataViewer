import { Settings, Eye, EyeOff, Gauge, Activity } from "lucide-react";
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
