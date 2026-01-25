import { useState, useEffect, useCallback } from "react";

export interface AppSettings {
  useKph: boolean;
  defaultHiddenFields: string[]; // Field names to hide by default
}

const SETTINGS_KEY = "dove-dataviewer-settings";

const defaultSettings: AppSettings = {
  useKph: false,
  defaultHiddenFields: [],
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

  const toggleFieldDefault = useCallback((fieldNames: string | string[]) => {
    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
    setSettingsState((prev) => {
      // Check if any of the names are already hidden
      const isHidden = names.some(name => prev.defaultHiddenFields.includes(name));
      if (isHidden) {
        // Remove all matching names
        return {
          ...prev,
          defaultHiddenFields: prev.defaultHiddenFields.filter((f) => !names.includes(f)),
        };
      } else {
        // Add all names
        return {
          ...prev,
          defaultHiddenFields: [...prev.defaultHiddenFields, ...names],
        };
      }
    });
  }, []);

  const isFieldHiddenByDefault = useCallback(
    (fieldName: string) => settings.defaultHiddenFields.includes(fieldName),
    [settings.defaultHiddenFields]
  );

  return {
    settings,
    setSettings,
    toggleFieldDefault,
    isFieldHiddenByDefault,
  };
}
