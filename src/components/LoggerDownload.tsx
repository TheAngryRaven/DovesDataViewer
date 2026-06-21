import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bluetooth } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoggerPicker } from "@/components/LoggerPicker";
import { useDeviceContext } from "@/contexts/DeviceContext";
import type { ParsedData } from "@/types/racing";

// The Fledgling BLE flow is the only heavy part — lazy-load it so the protocol
// bundle (`lib/ble/*`) loads only when the user actually picks the Fledgling.
// The host itself (button + picker) stays eager so the menu opens instantly and
// never depends on a chunk finishing to load.
const DataloggerDownload = lazy(() =>
  import("@/components/DataloggerDownload").then((m) => ({ default: m.DataloggerDownload })),
);

// The native MyChron Wi-Fi flow is likewise lazy so `@tauri-apps/api` (dynamic
// import inside it) never enters the web/eager bundle.
const MyChronDownload = lazy(() =>
  import("@/components/MyChronDownload").then((m) => ({ default: m.MyChronDownload })),
);

interface LoggerDownloadProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
  /**
   * Optional custom trigger (e.g. a big landing-page ActionTile). Receives the
   * handler that opens the logger picker. When omitted, the default outline
   * button is rendered.
   */
  renderTrigger?: (args: { onOpen: () => void }) => ReactNode;
}

/**
 * Entry point for "Download from logger": renders the trigger (button or a
 * caller-supplied tile) and the image-based `LoggerPicker`. Picking the
 * Fledgling mounts the lazy Bluetooth download flow; MyChron and Alfano are
 * handled inside the picker (explanatory dialogs).
 */
export function LoggerDownload({ onDataLoaded, autoSave, autoSaveFile, renderTrigger }: LoggerDownloadProps) {
  const { t } = useTranslation("logger");
  const { bleSupported } = useDeviceContext();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fledglingActive, setFledglingActive] = useState(false);
  const [mychronActive, setMychronActive] = useState(false);

  const openPicker = useCallback(() => setPickerOpen(true), []);

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onOpen: openPicker })
      ) : (
        <Button variant="outline" onClick={openPicker}>
          <Bluetooth className="w-4 h-4 mr-2" />
          {t("title")}
        </Button>
      )}

      <LoggerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        bleSupported={bleSupported}
        onSelectFledgling={() => {
          setPickerOpen(false);
          setFledglingActive(true);
        }}
        onSelectMychron={() => {
          setPickerOpen(false);
          setMychronActive(true);
        }}
      />

      {fledglingActive && (
        <Suspense fallback={null}>
          <DataloggerDownload
            autoStart
            onDataLoaded={onDataLoaded}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
            onClose={() => setFledglingActive(false)}
          />
        </Suspense>
      )}

      {mychronActive && (
        <Suspense fallback={null}>
          <MyChronDownload
            autoStart
            onDataLoaded={onDataLoaded}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
            onClose={() => setMychronActive(false)}
          />
        </Suspense>
      )}
    </>
  );
}
