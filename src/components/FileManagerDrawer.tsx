import { useEffect, useState } from "react";
import { X, Gauge, Cpu, Bluetooth, BluetoothOff, Loader2, Settings, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileEntry, FileMetadata } from "@/lib/fileStorage";
import { Kart } from "@/lib/kartStorage";
import { KartSetup } from "@/lib/setupStorage";
import { Note } from "@/lib/noteStorage";
import { ParsedData } from "@/types/racing";
import { FilesTab } from "./drawer/FilesTab";
import { KartsTab } from "./drawer/KartsTab";
import { SetupsTab } from "./drawer/SetupsTab";
import { NotesTab } from "./drawer/NotesTab";
import { DeviceSettingsTab } from "./drawer/DeviceSettingsTab";
import { DeviceTracksTab } from "./drawer/DeviceTracksTab";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { isBleSupported } from "@/lib/bleDatalogger";

type TopTab = "garage" | "device";
type GarageTab = "files" | "karts" | "setups" | "notes";
type DeviceTab = "settings" | "tracks";

const garageTabs: { key: GarageTab; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "karts", label: "Karts" },
  { key: "setups", label: "Setups" },
  { key: "notes", label: "Notes" },
];

const deviceTabs: { key: DeviceTab; label: string; icon: React.ReactNode }[] = [
  { key: "settings", label: "Settings", icon: <Settings className="w-3.5 h-3.5" /> },
  { key: "tracks", label: "Tracks", icon: <MapPin className="w-3.5 h-3.5" /> },
];

interface FileManagerDrawerProps {
  isOpen: boolean;
  files: FileEntry[];
  fileMetadataMap: Map<string, FileMetadata>;
  storageUsed: number;
  storageQuota: number;
  onClose: () => void;
  onLoadFile: (name: string) => Promise<Blob | null>;
  onDeleteFile: (name: string) => Promise<void>;
  onExportFile: (name: string) => Promise<void>;
  onSaveFile: (name: string, blob: Blob) => Promise<void>;
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave: boolean;
  // Kart props
  karts: Kart[];
  onAddKart: (kart: Omit<Kart, "id">) => Promise<void>;
  onUpdateKart: (kart: Kart) => Promise<void>;
  onRemoveKart: (id: string) => Promise<void>;
  // Note props
  currentFileName: string | null;
  notes: Note[];
  onAddNote: (text: string) => Promise<void>;
  onUpdateNote: (id: string, text: string) => Promise<void>;
  onRemoveNote: (id: string) => Promise<void>;
  // Session setup link
  sessionKartId: string | null;
  sessionSetupId: string | null;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
  // Setup props
  setups: KartSetup[];
  onAddSetup: (setup: Omit<KartSetup, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onUpdateSetup: (setup: KartSetup) => Promise<void>;
  onRemoveSetup: (id: string) => Promise<void>;
  onGetLatestSetupForKart: (kartId: string) => Promise<KartSetup | null>;
}

export function FileManagerDrawer({
  isOpen,
  files,
  fileMetadataMap,
  storageUsed,
  storageQuota,
  onClose,
  onLoadFile,
  onDeleteFile,
  onExportFile,
  onSaveFile,
  onDataLoaded,
  autoSave,
  karts,
  onAddKart,
  onUpdateKart,
  onRemoveKart,
  currentFileName,
  notes,
  onAddNote,
  onUpdateNote,
  onRemoveNote,
  sessionKartId,
  sessionSetupId,
  onSaveSessionSetup,
  setups,
  onAddSetup,
  onUpdateSetup,
  onRemoveSetup,
  onGetLatestSetupForKart,
}: FileManagerDrawerProps) {
  const [topTab, setTopTab] = useState<TopTab>("garage");
  const [garageTab, setGarageTab] = useState<GarageTab>("files");
  const [deviceTab, setDeviceTab] = useState<DeviceTab>("settings");

  const device = useDeviceContext();
  const bleAvailable = isBleSupported();

  // Reset tabs every time drawer opens
  useEffect(() => {
    if (isOpen) {
      setTopTab("garage");
      setGarageTab("files");
      setDeviceTab("settings");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[10000] bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-[10001] w-full md:w-[28vw] md:min-w-[320px] bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {topTab === "garage" ? (
              <Gauge className="w-5 h-5 text-primary" />
            ) : (
              <Cpu className="w-5 h-5 text-primary" />
            )}
            <h2 className="font-semibold text-foreground">
              {topTab === "garage" ? "Garage" : "Device"}
            </h2>
            {topTab === "device" && device.deviceName && (
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                — {device.deviceName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {topTab === "device" && device.connection && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={device.disconnectDevice}
              >
                Disconnect
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Top-level Tab Bar: Garage | Device */}
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setTopTab("garage")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              topTab === "garage"
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Gauge className="w-4 h-4" />
            Garage
          </button>
          <button
            onClick={() => setTopTab("device")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              topTab === "device"
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Cpu className="w-4 h-4" />
            Device
          </button>
        </div>

        {/* ── Garage Panel ── */}
        {topTab === "garage" && (
          <>
            {/* Garage Sub-Tab Bar */}
            <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
              {garageTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setGarageTab(tab.key)}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    garageTab === tab.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Garage Tab Content */}
            {garageTab === "files" && (
              <FilesTab
                files={files}
                fileMetadataMap={fileMetadataMap}
                storageUsed={storageUsed}
                storageQuota={storageQuota}
                onLoadFile={onLoadFile}
                onDeleteFile={onDeleteFile}
                onExportFile={onExportFile}
                onSaveFile={onSaveFile}
                onDataLoaded={onDataLoaded}
                onClose={onClose}
                autoSave={autoSave}
              />
            )}
            {garageTab === "karts" && (
              <KartsTab
                karts={karts}
                onAdd={onAddKart}
                onUpdate={onUpdateKart}
                onRemove={onRemoveKart}
              />
            )}
            {garageTab === "setups" && (
              <SetupsTab
                karts={karts}
                setups={setups}
                onAdd={onAddSetup}
                onUpdate={onUpdateSetup}
                onRemove={onRemoveSetup}
                onGetLatestForKart={onGetLatestSetupForKart}
              />
            )}
            {garageTab === "notes" && (
              <NotesTab
                fileName={currentFileName}
                notes={notes}
                onAdd={onAddNote}
                onUpdate={onUpdateNote}
                onRemove={onRemoveNote}
                karts={karts}
                setups={setups}
                sessionKartId={sessionKartId}
                sessionSetupId={sessionSetupId}
                onSaveSessionSetup={onSaveSessionSetup}
              />
            )}
          </>
        )}

        {/* ── Device Panel ── */}
        {topTab === "device" && (
          <>
            {!bleAvailable ? (
              /* BLE not supported */
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
                <BluetoothOff className="w-12 h-12 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Bluetooth Not Available</h3>
                <p className="text-sm text-muted-foreground max-w-[260px]">
                  Web Bluetooth is not supported in this browser. Try Chrome or Edge on a desktop or Android device.
                </p>
              </div>
            ) : !device.connection ? (
              /* Not connected — show connect prompt */
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
                <Bluetooth className="w-12 h-12 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Connect to Logger</h3>
                <p className="text-sm text-muted-foreground max-w-[260px]">
                  Connect to your DovesDataLogger to manage device settings and tracks.
                </p>
                <Button
                  onClick={device.connect}
                  disabled={device.isConnecting}
                  className="gap-2"
                >
                  {device.isConnecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <Bluetooth className="w-4 h-4" />
                      Connect
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* Connected — show device sub-tabs */
              <>
                {/* Device Sub-Tab Bar */}
                <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
                  {deviceTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setDeviceTab(tab.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        deviceTab === tab.key
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Device Tab Content */}
                {deviceTab === "settings" && (
                  <DeviceSettingsTab connection={device.connection} />
                )}
                {deviceTab === "tracks" && <DeviceTracksTab connection={device.connection!} />}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
