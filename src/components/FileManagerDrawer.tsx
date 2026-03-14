import { useCallback, useEffect, useState } from "react";
import { X, Gauge, Cpu, Bluetooth, BluetoothOff, Loader2, Settings, MapPin, Battery, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileEntry, FileMetadata } from "@/lib/fileStorage";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { VehicleType, SetupTemplate, TemplateSection } from "@/lib/templateStorage";
import { Note } from "@/lib/noteStorage";
import { ParsedData } from "@/types/racing";
import { FilesTab } from "./drawer/FilesTab";
import { VehiclesTab } from "./drawer/VehiclesTab";
import { SetupsTab } from "./drawer/SetupsTab";
import { NotesTab } from "./drawer/NotesTab";
import { DeviceSettingsTab } from "./drawer/DeviceSettingsTab";
import { DeviceTracksTab } from "./drawer/DeviceTracksTab";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { isBleSupported, requestBatteryLevel, type BatteryInfo } from "@/lib/bleDatalogger";

type TopTab = "garage" | "device";
type GarageTab = "files" | "vehicles" | "setups" | "notes";
type DeviceTab = "settings" | "tracks";

const garageTabs: { key: GarageTab; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "vehicles", label: "Vehicles" },
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
  // Vehicle props
  vehicles: Vehicle[];
  vehicleTypes: VehicleType[];
  templates: SetupTemplate[];
  onAddVehicle: (vehicle: Omit<Vehicle, "id">) => Promise<void>;
  onUpdateVehicle: (vehicle: Vehicle) => Promise<void>;
  onRemoveVehicle: (id: string) => Promise<void>;
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
  setups: VehicleSetup[];
  onAddSetup: (setup: Omit<VehicleSetup, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onUpdateSetup: (setup: VehicleSetup) => Promise<void>;
  onRemoveSetup: (id: string) => Promise<void>;
  onGetLatestSetupForVehicle: (vehicleId: string) => Promise<VehicleSetup | null>;
  onAddVehicleType: (name: string, wheelCount: 2 | 4, includeTires: boolean, sections: TemplateSection[]) => Promise<any>;
  onRemoveVehicleType: (vehicleTypeId: string, templateId: string) => Promise<void>;
}

export function FileManagerDrawer({
  isOpen, files, fileMetadataMap, storageUsed, storageQuota,
  onClose, onLoadFile, onDeleteFile, onExportFile, onSaveFile, onDataLoaded, autoSave,
  vehicles, vehicleTypes, templates,
  onAddVehicle, onUpdateVehicle, onRemoveVehicle,
  currentFileName, notes, onAddNote, onUpdateNote, onRemoveNote,
  sessionKartId, sessionSetupId, onSaveSessionSetup,
  setups, onAddSetup, onUpdateSetup, onRemoveSetup, onGetLatestSetupForVehicle,
  onAddVehicleType, onRemoveVehicleType,
}: FileManagerDrawerProps) {
  const [topTab, setTopTab] = useState<TopTab>("garage");
  const [garageTab, setGarageTab] = useState<GarageTab>("files");
  const [deviceTab, setDeviceTab] = useState<DeviceTab>("settings");

  const device = useDeviceContext();
  const bleAvailable = isBleSupported();
  const [battery, setBattery] = useState<BatteryInfo | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTopTab("garage");
      setGarageTab("files");
      setDeviceTab("settings");
      setBattery(null);
    }
  }, [isOpen]);

  // Fetch battery on connect / when switching to device tab
  const fetchBattery = useCallback(async () => {
    if (!device.connection) return;
    try {
      const info = await requestBatteryLevel(device.connection);
      setBattery(info);
    } catch {
      // silent — device may not support BATT yet
    }
  }, [device.connection]);

  useEffect(() => {
    if (device.connection && topTab === "device") {
      fetchBattery();
    }
    if (!device.connection) setBattery(null);
  }, [device.connection, topTab, fetchBattery]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[10000] bg-black/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[10001] w-full md:w-[28vw] md:min-w-[320px] bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {topTab === "garage" ? <Gauge className="w-5 h-5 text-primary" /> : <Cpu className="w-5 h-5 text-primary" />}
            <h2 className="font-semibold text-foreground">{topTab === "garage" ? "Garage" : "Device"}</h2>
            {topTab === "device" && device.deviceName && (
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">— {device.deviceName}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {topTab === "device" && device.connection && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={device.disconnectDevice}>Disconnect</Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Top-level Tab Bar */}
        <div className="flex border-b border-border shrink-0">
          <button onClick={() => setTopTab("garage")} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${topTab === "garage" ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}>
            <Gauge className="w-4 h-4" /> Garage
          </button>
          <button onClick={() => setTopTab("device")} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${topTab === "device" ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}>
            <Cpu className="w-4 h-4" /> Device
          </button>
        </div>

        {/* Garage Panel */}
        {topTab === "garage" && (
          <>
            <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
              {garageTabs.map(tab => (
                <button key={tab.key} onClick={() => setGarageTab(tab.key)} className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${garageTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                  {tab.label}
                </button>
              ))}
            </div>

            {garageTab === "files" && (
              <FilesTab files={files} fileMetadataMap={fileMetadataMap} storageUsed={storageUsed} storageQuota={storageQuota} onLoadFile={onLoadFile} onDeleteFile={onDeleteFile} onExportFile={onExportFile} onSaveFile={onSaveFile} onDataLoaded={onDataLoaded} onClose={onClose} autoSave={autoSave} />
            )}
            {garageTab === "vehicles" && (
              <VehiclesTab vehicles={vehicles} vehicleTypes={vehicleTypes} onAdd={onAddVehicle} onUpdate={onUpdateVehicle} onRemove={onRemoveVehicle} />
            )}
            {garageTab === "setups" && (
              <SetupsTab
                vehicles={vehicles}
                setups={setups}
                vehicleTypes={vehicleTypes}
                templates={templates}
                onAdd={onAddSetup}
                onUpdate={onUpdateSetup}
                onRemove={onRemoveSetup}
                onGetLatestForVehicle={onGetLatestSetupForVehicle}
                onAddVehicleType={onAddVehicleType}
                onRemoveVehicleType={onRemoveVehicleType}
              />
            )}
            {garageTab === "notes" && (
              <NotesTab
                fileName={currentFileName}
                notes={notes}
                onAdd={onAddNote}
                onUpdate={onUpdateNote}
                onRemove={onRemoveNote}
                vehicles={vehicles}
                setups={setups}
                sessionKartId={sessionKartId}
                sessionSetupId={sessionSetupId}
                onSaveSessionSetup={onSaveSessionSetup}
              />
            )}
          </>
        )}

        {/* Device Panel */}
        {topTab === "device" && (
          <>
            {!bleAvailable ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
                <BluetoothOff className="w-12 h-12 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Bluetooth Not Available</h3>
                <p className="text-sm text-muted-foreground max-w-[260px]">Web Bluetooth is not supported in this browser. Try Chrome or Edge on a desktop or Android device.</p>
              </div>
            ) : !device.connection ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
                <Bluetooth className="w-12 h-12 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Connect to Logger</h3>
                <p className="text-sm text-muted-foreground max-w-[260px]">Connect to your DovesDataLogger to manage device settings and tracks.</p>
                <Button onClick={device.connect} disabled={device.isConnecting} className="gap-2">
                  {device.isConnecting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>) : (<><Bluetooth className="w-4 h-4" /> Connect</>)}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
                  {deviceTabs.map(tab => (
                    <button key={tab.key} onClick={() => setDeviceTab(tab.key)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${deviceTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>
                {deviceTab === "settings" && <DeviceSettingsTab connection={device.connection} />}
                {deviceTab === "tracks" && <DeviceTracksTab connection={device.connection!} />}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
