import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save, AlertCircle, RefreshCw, RotateCcw, UserRound, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { type BleConnection } from "@/lib/bleDatalogger";
import type { DeviceDetails } from "@/lib/loggers";
import {
  DEVICE_SETTINGS_SCHEMA,
  availableOptions,
  fromDisplayUnits,
  getSettingDef,
  isAdvancedSetting,
  settingUnitLabel,
  toDisplayUnits,
  validateSettingValue,
  type DeviceSettingDef,
  type UnitPrefs,
} from "@/lib/deviceSettingsSchema";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalSettingsContext } from "@/contexts/SettingsContext";
import { FirmwareUpdateSection } from "./FirmwareUpdateSection";
import { LedModeHelpDialog } from "./LedModeHelpDialog";

/** The setting whose field offers a "use profile name" shortcut. */
const DEVICE_NAME_KEY = "device_name";

interface DeviceSettingsTabProps {
  /** Transport-neutral Device-tab surface (Web Bluetooth or native IPC). */
  details: DeviceDetails;
  /**
   * The raw Web Bluetooth handle, present on the web only. The firmware OTA
   * section still drives the BLE link directly, so it renders only when this
   * is set; the native app points at the Fledgling download screen instead
   * (where native firmware update already lives).
   */
  bleConnection?: BleConnection;
  onResetComplete?: () => void;
}

interface SettingRow {
  key: string;
  value: string;
  originalValue: string;
  error: string | null;
  saving: boolean;
}

export function DeviceSettingsTab({ details, bleConnection, onResetComplete }: DeviceSettingsTabProps) {
  const { t } = useTranslation("drawer");
  const { user } = useAuth();
  // Optional, not required: this tab renders from the drawer, which can sit
  // outside the settings provider (the Profile tab on the landing page does).
  // Imperial is the app's own default, so that is the fallback.
  const appSettings = useOptionalSettingsContext();
  const unitPrefs: UnitPrefs = {
    useKph: appSettings?.useKph ?? false,
    useMetricWeather: appSettings?.useMetricWeather ?? false,
  };
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // The signed-in user's account name, used by the "use profile name" shortcut
  // on the Device Name field. Loaded lazily so the Supabase client never lands
  // on the offline-first eager graph; null when signed out or unavailable.
  const [profileName, setProfileName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setProfileName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) setProfileName(data?.display_name?.trim() || null);
      } catch {
        if (!cancelled) setProfileName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const settings = await details.listSettings();
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
    } catch (err) {
      setFetchError((err instanceof Error ? err.message : t("device.readFailed")));
    } finally {
      setLoading(false);
    }
  }, [details, t]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Which keys this device actually reports. Feature flags are per-firmware-
  // channel, so an option can require a key the device must also have (see
  // availableOptions) rather than offering a mode it cannot render.
  const deviceKeys = new Set(rows.map((r) => r.key));

  /**
   * The two directions a unit-bearing setting travels. Everything in `rows`
   * is stored in DEVICE units — mph, Celsius — exactly as it came off the
   * wire and exactly as it goes back; only the input box shows the viewer's
   * preferred unit. Keeping the row in device units is what lets validation
   * enforce the firmware's own clamp rather than a converted copy of it.
   */
  const displayValue = (def: DeviceSettingDef | null, value: string): string => {
    if (!def?.unit || value === "") return value;
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    return String(toDisplayUnits(def.unit, n, unitPrefs));
  };
  const deviceValue = (def: DeviceSettingDef | null, shown: string): string => {
    if (!def?.unit || shown === "") return shown;
    const n = Number(shown);
    if (!Number.isFinite(n)) return shown;
    return String(fromDisplayUnits(def.unit, n, unitPrefs));
  };

  const handleChange = (key: string, newValue: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, value: newValue, error: validateSettingValue(r.key, newValue) }
          : r
      )
    );
  };

  /** Edit handler for a field shown in a converted unit. */
  const handleDisplayChange = (key: string, shown: string) => {
    handleChange(key, deviceValue(getSettingDef(key), shown));
  };

  const handleSave = async (key: string) => {
    const row = rows.find((r) => r.key === key);
    if (!row || row.error || row.value === row.originalValue) return;

    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, saving: true } : r))
    );

    try {
      await details.setSetting(row.key, row.value);
      setRows((prev) =>
        prev.map((r) =>
          r.key === key ? { ...r, originalValue: r.value, saving: false } : r
        )
      );
      toast.success(t("device.toastSaved", { name: getSettingDef(row.key)?.label ?? row.key }));
    } catch (err) {
      setRows((prev) =>
        prev.map((r) => (r.key === key ? { ...r, saving: false } : r))
      );
      toast.error(t("device.toastSaveFailed", { error: err instanceof Error ? err.message : t("device.unknownError") }));
    }
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setResetting(true);
    try {
      await details.resetSettings();
      toast.success(t("device.toastReset"));
      onResetComplete?.();
    } catch (err) {
      toast.error(t("device.toastResetFailed", { error: err instanceof Error ? err.message : t("device.unknownError") }));
      setResetting(false);
      setConfirmReset(false);
    }
  };

  // Advanced settings (detection thresholds, debug toggles) live under a
  // collapsed section; anything unflagged — including unknown keys from a
  // newer firmware — stays in the main list.
  const normalRows = rows.filter((r) => !isAdvancedSetting(r.key));
  const advancedRows = rows.filter((r) => isAdvancedSetting(r.key));

  const renderRow = (row: SettingRow) => {
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
          {def?.helpTopic === "ledStatusModes" && <LedModeHelpDialog />}
        </div>
        <div className="flex items-center gap-2">
          {def?.type === "enum" && def.options?.length ? (
            <Select value={row.value} onValueChange={(v) => handleChange(row.key, v)}>
              <SelectTrigger className="h-9 flex-1 text-sm">
                {/* A device can hold a value this build doesn't know — an
                    older or newer firmware, or a hand-edited SETTINGS.json.
                    Show it verbatim rather than an empty box. */}
                <SelectValue placeholder={row.value || undefined} />
              </SelectTrigger>
              <SelectContent>
                {availableOptions(def, deviceKeys, row.value).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : def?.unit ? (
            // Shown in the viewer's unit, stored in the device's. The suffix
            // is not decoration: without it a "60" that becomes "97" when the
            // KPH toggle flips reads as the setting having changed itself.
            <div className="relative flex-1">
              <Input
                value={displayValue(def, row.value)}
                onChange={(e) => handleDisplayChange(row.key, e.target.value)}
                className="h-9 pr-12 text-sm"
                type="number"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                {settingUnitLabel(def.unit, unitPrefs)}
              </span>
            </div>
          ) : (
            <Input
              value={row.value}
              onChange={(e) => handleChange(row.key, e.target.value)}
              className="h-9 text-sm flex-1"
              type={def?.type === "number" ? "number" : "text"}
              maxLength={def?.maxLength}
            />
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={!isDirty || !!row.error || row.saving}
            onClick={() => handleSave(row.key)}
          >
            {row.saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
          </Button>
        </div>
        {row.key === DEVICE_NAME_KEY && profileName && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => handleChange(row.key, profileName.slice(0, def?.maxLength ?? profileName.length))}
          >
            <UserRound className="w-3.5 h-3.5" />
            {t("device.useProfileName")}
          </Button>
        )}
        {row.error && (
          <p className="text-xs text-destructive">{row.error}</p>
        )}
      </div>
    );
  };

  const settingsBody = loading ? (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-sm text-muted-foreground">{t("device.readingSettings")}</span>
    </div>
  ) : fetchError ? (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <AlertCircle className="w-8 h-8 text-destructive" />
      <p className="text-sm text-muted-foreground">{fetchError}</p>
      <Button variant="outline" size="sm" onClick={fetchSettings} className="gap-2">
        <RefreshCw className="w-4 h-4" /> {t("device.retry")}
      </Button>
    </div>
  ) : (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">{t("device.noSettings")}</p>
      )}
      {normalRows.map(renderRow)}
      {advancedRows.length > 0 && (
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced} className="border border-border rounded-md">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors">
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex-1 text-left">
              {t("device.advanced")}
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-3 pb-3 pt-1 space-y-3">
              {advancedRows.map(renderRow)}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
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
            {confirmReset ? t("device.resetConfirm") : t("device.reset")}
          </Button>
          {confirmReset && !resetting && (
            <button
              onClick={() => setConfirmReset(false)}
              className="w-full mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("device.cancel")}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {bleConnection ? (
        <FirmwareUpdateSection />
      ) : (
        // Native app: firmware OTA lives in the Fledgling download flow
        // (useNativeFirmwareUpdate) — point there instead of duplicating it.
        <p className="text-xs text-muted-foreground">{t("device.firmwareNativeHint")}</p>
      )}
      {settingsBody}
    </div>
  );
}
