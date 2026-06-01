import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { FileDeleteConfirmContext } from "@/plugins/mounts";
import { fileSyncStatus, getFileRecord, unselectFile } from "./fileSync";
import { deleteCloudFile } from "./syncEngine";
import { markPending } from "./pendingSync";
import { FILE_STORE } from "./syncStores";

/**
 * Mounted inside the file delete-confirm banner. When the file being deleted is
 * synced, it offers an opt-in "also delete the cloud copy" checkbox and, on
 * confirm, removes the cloud blob + index (or queues it as a pending delete when
 * offline / on failure, so it propagates on reconnect). The cloud copy is a
 * backup, so the box defaults off — local deletion alone never touches it.
 */
export default function FileDeleteToggle({ ctx }: { ctx: FileDeleteConfirmContext }) {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const { fileName, registerOnConfirm } = ctx;
  const [synced, setSynced] = useState(false);
  const [alsoDelete, setAlsoDelete] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setSynced(false);
      return;
    }
    getFileRecord(fileName).then((r) => active && setSynced(fileSyncStatus(r) === "synced"));
    return () => {
      active = false;
    };
  }, [user, fileName]);

  useEffect(() => {
    if (!user || !synced || !alsoDelete) {
      registerOnConfirm(null);
      return;
    }
    const userId = user.id;
    registerOnConfirm(async () => {
      if (!online) {
        await markPending({ store: FILE_STORE, key: fileName, type: "delete" });
        return;
      }
      try {
        await deleteCloudFile(userId, fileName);
        await unselectFile(fileName);
      } catch {
        // Network/other failure — retry the cloud delete on reconnect.
        await markPending({ store: FILE_STORE, key: fileName, type: "delete" });
      }
    });
    return () => registerOnConfirm(null);
  }, [user, synced, alsoDelete, online, fileName, registerOnConfirm]);

  if (!user || !synced) return null;

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={`cloud-del-${fileName}`}
        checked={alsoDelete}
        onCheckedChange={setAlsoDelete}
        className="scale-90"
      />
      <Label htmlFor={`cloud-del-${fileName}`} className="text-xs text-muted-foreground">
        Also delete the synced copy from the cloud backup
      </Label>
    </div>
  );
}
