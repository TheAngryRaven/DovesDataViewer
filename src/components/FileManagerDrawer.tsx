import { useEffect, useState } from "react";
import { X, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileEntry } from "@/lib/fileStorage";
import { Kart } from "@/lib/kartStorage";
import { KartSetup } from "@/lib/setupStorage";
import { Note } from "@/lib/noteStorage";
import { ParsedData } from "@/types/racing";
import { FilesTab } from "./drawer/FilesTab";
import { KartsTab } from "./drawer/KartsTab";
import { SetupsTab } from "./drawer/SetupsTab";
import { NotesTab } from "./drawer/NotesTab";

type DrawerTab = "files" | "karts" | "setups" | "notes";

const tabs: { key: DrawerTab; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "karts", label: "Karts" },
  { key: "setups", label: "Setups" },
  { key: "notes", label: "Notes" },
];

interface FileManagerDrawerProps {
  isOpen: boolean;
  files: FileEntry[];
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
  const [activeTab, setActiveTab] = useState<DrawerTab>("files");

  // Reset to files tab every time drawer opens
  useEffect(() => {
    if (isOpen) setActiveTab("files");
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
            <Gauge className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">Garage</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "files" && (
          <FilesTab
            files={files}
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
        {activeTab === "karts" && (
          <KartsTab
            karts={karts}
            onAdd={onAddKart}
            onUpdate={onUpdateKart}
            onRemove={onRemoveKart}
          />
        )}
        {activeTab === "setups" && (
          <SetupsTab
            karts={karts}
            setups={setups}
            onAdd={onAddSetup}
            onUpdate={onUpdateSetup}
            onRemove={onRemoveSetup}
            onGetLatestForKart={onGetLatestSetupForKart}
          />
        )}
        {activeTab === "notes" && (
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
      </div>
    </>
  );
}
