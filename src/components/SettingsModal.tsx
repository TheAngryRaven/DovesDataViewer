import { Settings, Eye, EyeOff, Gauge } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AppSettings } from "@/hooks/useSettings";

// Known telemetry fields that can be configured
const CONFIGURABLE_FIELDS = [
  { name: "altitude", label: "Altitude", description: "GPS altitude data" },
  { name: "pace", label: "Pace", description: "Time delta vs reference lap" },
  { name: "rpm", label: "RPM", description: "Engine revolutions per minute" },
  { name: "water_temp", label: "Water Temp", description: "Coolant temperature" },
  { name: "egt", label: "EGT", description: "Exhaust gas temperature" },
  { name: "oil_temp", label: "Oil Temp", description: "Oil temperature" },
  { name: "throttle", label: "Throttle", description: "Throttle position" },
  { name: "brake", label: "Brake", description: "Brake pressure/position" },
];

interface SettingsModalProps {
  settings: AppSettings;
  onSettingsChange: (updates: Partial<AppSettings>) => void;
  onToggleFieldDefault: (fieldName: string) => void;
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
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

          <Separator />

          {/* Default Field Visibility */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">Default Field Visibility</h3>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Choose which data fields are visible by default when loading a file. Hidden fields can still be enabled manually.
            </p>
            <div className="space-y-2 pl-6">
              {CONFIGURABLE_FIELDS.map((field) => {
                const isHidden = settings.defaultHiddenFields.includes(field.name);
                return (
                  <button
                    key={field.name}
                    onClick={() => onToggleFieldDefault(field.name)}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
