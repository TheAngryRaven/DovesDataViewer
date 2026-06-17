import { useState, useCallback, useEffect } from "react";
import { ParsedData, FieldMapping } from "@/types/racing";

/**
 * Manages the core session data: parsed GPS data, current file name, and
 * field mappings. The sample log is now an ordinary seeded file (see
 * `lib/sampleData.ts`), loaded through the normal file-load path.
 */
export function useSessionData(
  isFieldHiddenByDefault: (fieldName: string) => boolean,
  defaultHiddenFields: string[]
) {
  const [data, setData] = useState<ParsedData | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);

  // Sync field visibility when settings change (real-time toggle)
  useEffect(() => {
    if (fieldMappings.length === 0) return;
    setFieldMappings((prev) =>
      prev.map((f) => ({
        ...f,
        enabled: !isFieldHiddenByDefault(f.name),
      }))
    );
    // Intentional: re-run only when visibility settings change, not when
    // fieldMappings.length changes (new file loads handle their own visibility).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultHiddenFields, isFieldHiddenByDefault]);

  const applyFieldMappings = useCallback(
    (parsedData: ParsedData) => {
      return parsedData.fieldMappings.map((f) => ({
        ...f,
        enabled: f.enabled && !isFieldHiddenByDefault(f.name),
      }));
    },
    [isFieldHiddenByDefault]
  );

  const loadParsedData = useCallback(
    (parsedData: ParsedData, fileName?: string) => {
      setData(parsedData);
      if (fileName) setCurrentFileName(fileName);
      setFieldMappings(applyFieldMappings(parsedData));
    },
    [applyFieldMappings]
  );

  const handleFieldToggle = useCallback((fieldName: string) => {
    setFieldMappings((prev) =>
      prev.map((f) => (f.name === fieldName ? { ...f, enabled: !f.enabled } : f))
    );
  }, []);

  // Find first valid GPS sample for weather lookup
  const sessionGpsPoint = (() => {
    if (!data?.samples?.length) return undefined;
    const validSample = data.samples.find(
      (s) => s.lat !== 0 && s.lon !== 0 && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180
    );
    return validSample ? { lat: validSample.lat, lon: validSample.lon } : undefined;
  })();

  return {
    data,
    currentFileName,
    fieldMappings,
    loadParsedData,
    handleFieldToggle,
    sessionGpsPoint,
  };
}
