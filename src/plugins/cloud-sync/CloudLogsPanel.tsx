import { useCallback, useEffect, useState } from "react";
import { FileText, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { deleteFile, listFiles } from "@/lib/fileStorage";
import { deleteCloudFile, listCloudFiles, type CloudFile } from "./syncEngine";
import { unselectFile } from "./fileSync";
import { formatBytes } from "./storageTypes";

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Profile-tab panel: manage the log files stored in YOUR cloud. Deleting removes
// the cloud copy only (other devices keep what they've downloaded); an opt-in
// toggle also removes the local copy from this device.
export default function CloudLogsPanel(_props: PluginPanelProps) {
  const { user, loading } = useAuth();
  const [files, setFiles] = useState<CloudFile[] | null>(null);
  const [localNames, setLocalNames] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [alsoLocal, setAlsoLocal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [cloud, local] = await Promise.all([listCloudFiles(user.id), listFiles()]);
      cloud.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
      setFiles(cloud);
      setLocalNames(new Set(local.map((f) => f.name)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cloud files");
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!user) {
    return (
      <p className="text-xs text-muted-foreground">
        Sign in to manage the log files stored in your cloud.
      </p>
    );
  }

  const startConfirm = (name: string) => {
    setConfirming(name);
    setAlsoLocal(false);
  };

  const handleDelete = async (file: CloudFile) => {
    const removeLocal = alsoLocal && localNames.has(file.name);
    setBusy(file.name);
    try {
      await deleteCloudFile(user.id, file.name);
      await unselectFile(file.name);
      if (removeLocal) await deleteFile(file.name);
      toast.success(
        removeLocal
          ? `Deleted "${file.name}" from the cloud and this device.`
          : `Deleted "${file.name}" from the cloud.`,
      );
      setConfirming(null);
      setAlsoLocal(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!files) return <p className="text-xs text-muted-foreground">Loading cloud files…</p>;
  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground">No log files in your cloud yet.</p>;
  }

  return (
    <div className="space-y-1.5">
      {files.map((file) => {
        const isConfirming = confirming === file.name;
        const onDevice = localNames.has(file.name);
        return (
          <div key={file.name} className="rounded-md border border-border">
            <div className="flex items-center gap-2 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{file.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDate(file.uploadedAt)}
                  {file.size != null && ` · ${formatBytes(file.size)}`}
                  {onDevice && " · on this device"}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                disabled={busy === file.name}
                onClick={() => startConfirm(file.name)}
                aria-label={`Delete ${file.name} from cloud`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {isConfirming && (
              <div className="space-y-2 border-t border-destructive/30 bg-destructive/5 px-3 py-2.5">
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Permanently delete the <strong>cloud copy</strong>? This can't be undone.</span>
                </p>
                {onDevice && (
                  <div className="flex items-center gap-2">
                    <Switch id={`local-${file.name}`} checked={alsoLocal} onCheckedChange={setAlsoLocal} disabled={busy === file.name} />
                    <Label htmlFor={`local-${file.name}`} className="text-xs text-muted-foreground">
                      Also delete the local file from this device (other devices keep their copy)
                    </Label>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === file.name} onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={busy === file.name} onClick={() => void handleDelete(file)}>
                    {busy === file.name ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
