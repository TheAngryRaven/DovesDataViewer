import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, CloudOff, CloudUpload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { FileRowContext } from "@/plugins/mounts";
import { isSampleFileName } from "@/lib/sampleData";
import { fileSyncStatus, getFileRecord, selectFile, unselectFile, type FileSyncState } from "./fileSync";
import { pushFile } from "./syncEngine";

const TITLE_KEYS = {
  off: "fileSync.off",
  pending: "fileSync.pending",
  synced: "fileSync.synced",
} as const satisfies Record<FileSyncState, string>;

export default function FileSyncToggle({ ctx }: { ctx: FileRowContext }) {
  const { t } = useTranslation("plugins");
  const { user } = useAuth();
  const online = useOnlineStatus();
  const name = ctx.file.name;
  // The bundled sample is seeded locally on every device, so there's nothing to
  // back up. Show it as "synced" (a static, disabled cloud) so the user can't
  // accidentally upload the multi-MB sample to their cloud quota.
  const isSample = isSampleFileName(name);
  const [state, setState] = useState<FileSyncState>("off");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isSample) return;
    let active = true;
    getFileRecord(name).then((r) => active && setState(fileSyncStatus(r)));
    return () => {
      active = false;
    };
  }, [name, isSample]);

  if (isSample) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 opacity-70 text-primary"
        disabled
        title={t("fileSync.sample")}
        aria-pressed
      >
        <Cloud className="w-3.5 h-3.5" />
      </Button>
    );
  }

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
      title={t(TITLE_KEYS[state])}
      aria-pressed={state !== "off"}
    >
      <Icon className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
    </Button>
  );
}
