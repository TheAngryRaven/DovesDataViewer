import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, AlertCircle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { type BleConnection } from "@/lib/bleDatalogger";
import { requestSettingsList, setDeviceSetting, resetDeviceSettings } from "@/lib/bleDatalogger";
import {
  DEVICE_SETTINGS_SCHEMA,
  getSettingDef,
  validateSettingValue,
} from "@/lib/deviceSettingsSchema";

interface DeviceSettingsTabProps {
  connection: BleConnection;
  onResetComplete?: () => void;
}

interface SettingRow {
  key: string;
  value: string;
  originalValue: string;
  error: string | null;
  saving: boolean;
}

export function DeviceSettingsTab({ connection, onResetComplete }: DeviceSettingsTabProps) {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const settings = await requestSettingsList(connection);
      // Build rows: schema-defined keys first (in order), then unknown keys
      const knownKeys = DEVICE_SETTINGS_SCHEMA.map((s) => s.key);
      const orderedKeys = [
        ...knownKeys.filter((k) => k in settings),
        ...Object.keys(settings).filter((k) => !knownKeys.includes(k)),
      ];
      setRows(
        orderedKeys.map((key) => ({
          key,
          value: settings[key],
          originalValue: settings[key],
          error: null,
          saving: false,
        }))
      );
    } catch (err: any) {
      setFetchError(err?.message ?? "Failed to read settings");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleChange = (index: number, newValue: string) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? { ...r, value: newValue, error: validateSettingValue(r.key, newValue) }
          : r
      )
    );
  };

  const handleSave = async (index: number) => {
    const row = rows[index];
    if (row.error || row.value === row.originalValue) return;

    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, saving: true } : r))
    );

    try {
      await setDeviceSetting(connection, row.key, row.value);
      setRows((prev) =>
        prev.map((r, i) =>
          i === index ? { ...r, originalValue: r.value, saving: false } : r
        )
      );
      toast.success(`Saved ${getSettingDef(row.key)?.label ?? row.key}`);
    } catch (err: any) {
      setRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, saving: false } : r))
      );
      toast.error(`Failed to save: ${err?.message ?? "Unknown error"}`);
    }
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setResetting(true);
    try {
      await resetDeviceSettings(connection);
      toast.success("Settings reset to defaults — device is rebooting");
      onResetComplete?.();
    } catch (err: any) {
      toast.error(`Reset failed: ${err?.message ?? "Unknown error"}`);
      setResetting(false);
      setConfirmReset(false);
    }
  };


    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Reading settings…</span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3 text-center">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{fetchError}</p>
        <Button variant="outline" size="sm" onClick={fetchSettings} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No settings found on device.</p>
      )}
      {rows.map((row, i) => {
        const def = getSettingDef(row.key);
        const isDirty = row.value !== row.originalValue;
        return (
          <div key={row.key} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium text-foreground">
                  {def?.label ?? row.key}
                </label>
                {def?.description && (
                  <p className="text-xs text-muted-foreground">{def.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={row.value}
                onChange={(e) => handleChange(i, e.target.value)}
                className="h-9 text-sm flex-1"
                type={def?.type === "number" ? "number" : "text"}
                maxLength={def?.maxLength}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={!isDirty || !!row.error || row.saving}
                onClick={() => handleSave(i)}
              >
                {row.saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
              </Button>
            </div>
            {row.error && (
              <p className="text-xs text-destructive">{row.error}</p>
            )}
          </div>
        );
      })}
      {rows.length > 0 && (
        <div className="pt-4 border-t border-border">
          <Button
            variant={confirmReset ? "destructive" : "outline"}
            size="sm"
            className="w-full gap-2"
            disabled={resetting}
            onClick={handleReset}
          >
            {resetting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            {confirmReset ? "Confirm Reset — Device Will Reboot" : "Reset Settings to Default"}
          </Button>
          {confirmReset && !resetting && (
            <button
              onClick={() => setConfirmReset(false)}
              className="w-full mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
