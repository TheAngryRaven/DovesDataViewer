import { useEffect, useState } from "react";
import { Cloud, CloudOff, CloudUpload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { FileRowContext } from "@/plugins/mounts";
import { fileSyncStatus, getFileRecord, selectFile, unselectFile, type FileSyncState } from "./fileSync";
import { pushFile } from "./syncEngine";

const TITLES: Record<FileSyncState, string> = {
  off: "Sync this file to the cloud",
  pending: "Selected — uploads once you're signed in and online",
  synced: "Synced — click to stop syncing (cloud copy is kept)",
};

export default function FileSyncToggle({ ctx }: { ctx: FileRowContext }) {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const name = ctx.file.name;
  const [state, setState] = useState<FileSyncState>("off");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getFileRecord(name).then((r) => active && setState(fileSyncStatus(r)));
    return () => {
      active = false;
    };
  }, [name]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state === "off") {
        await selectFile(name);
        if (user && online) {
          await pushFile(user.id, name);
          setState("synced");
        } else {
          setState("pending"); // intent recorded; uploads later
        }
      } else {
        await unselectFile(name);
        setState("off");
      }
    } catch {
      setState("pending"); // selected, but the upload failed — retry later
    } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? Loader2 : state === "synced" ? Cloud : state === "pending" ? CloudUpload : CloudOff;
  const color = state === "synced" ? "text-primary" : "text-muted-foreground";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 shrink-0 opacity-70 hover:opacity-100 ${color}`}
      onClick={toggle}
      disabled={busy}
      title={TITLES[state]}
      aria-pressed={state !== "off"}
    >
      <Icon className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
    </Button>
  );
}
