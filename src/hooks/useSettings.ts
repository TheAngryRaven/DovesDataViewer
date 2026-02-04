import { useState, useEffect, useCallback } from "react";
import { isFieldHiddenByCanonical, CanonicalFieldId } from "@/lib/fieldResolver";

export interface AppSettings {
  useKph: boolean;
  gForceSmoothing: boolean;
  gForceSmoothingStrength: number; // 0-100, maps to window size
  defaultHiddenFields: CanonicalFieldId[]; // Canonical field IDs to hide by default
  // Braking zone detection settings
  brakingEntryThreshold: number;    // 10-50, represents 0.10-0.50g (default: 25)
  brakingExitThreshold: number;     // 5-25, represents 0.05-0.25g (default: 10)
  brakingMinDuration: number;       // 50-500ms (default: 120)
  brakingSmoothingAlpha: number;    // 10-80, represents 0.1-0.8 (default: 40)
}

const SETTINGS_KEY = "dove-dataviewer-settings";

const defaultSettings: AppSettings = {
  useKph: false,
  gForceSmoothing: true,
  gForceSmoothingStrength: 50,
  defaultHiddenFields: [],
  // Braking zone defaults
  brakingEntryThreshold: 25,      // -0.25g
  brakingExitThreshold: 10,       // -0.10g
  brakingMinDuration: 120,        // 120ms
  brakingSmoothingAlpha: 40,      // 0.4
};

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        return { ...defaultSettings, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
    return defaultSettings;
  });

  // Persist settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  }, [settings]);

  const setSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...updates }));
  }, []);

  const toggleFieldDefault = useCallback((canonicalId: CanonicalFieldId) => {
    setSettingsState((prev) => {
      const isHidden = prev.defaultHiddenFields.includes(canonicalId);
      if (isHidden) {
        return {
          ...prev,
          defaultHiddenFields: prev.defaultHiddenFields.filter((f) => f !== canonicalId),
        };
      } else {
        return {
          ...prev,
          defaultHiddenFields: [...prev.defaultHiddenFields, canonicalId],
        };
      }
    });
  }, []);

  // Check if a field name should be hidden based on canonical mapping
  const isFieldHiddenByDefault = useCallback(
    (fieldName: string) => isFieldHiddenByCanonical(fieldName, settings.defaultHiddenFields),
    [settings.defaultHiddenFields]
  );

  return {
    settings,
    setSettings,
    toggleFieldDefault,
    isFieldHiddenByDefault,
  };
}
