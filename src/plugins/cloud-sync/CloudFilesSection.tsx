import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CloudDownload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { FileManagerSectionContext } from "@/plugins/mounts";
import { cloudOnlyNames, markPushed } from "./fileSync";
import { listCloudFiles, downloadCloudFile, type CloudFile } from "./syncEngine";

/**
 * Lists files that exist in the user's cloud but not on this device, each with a
 * per-file pull. Pulled files persist via `ctx.onSaveFile` (which refreshes the
 * file list), so they move out of this section and into the list automatically.
 */
export default function CloudFilesSection({ ctx }: { ctx: FileManagerSectionContext }) {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const [cloud, setCloud] = useState<CloudFile[] | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !online) {
      setCloud(null);
      return;
    }
    let active = true;
    listCloudFiles(user.id)
      .then((c) => active && setCloud(c))
      .catch(() => active && setCloud([]));
    return () => {
      active = false;
    };
  }, [user, online]);

  const localNames = useMemo(() => ctx.files.map((f) => f.name), [ctx.files]);
  const onlyInCloud = useMemo(
    () => cloudOnlyNames((cloud ?? []).map((c) => c.name), localNames),
    [cloud, localNames],
  );

  if (!user || onlyInCloud.length === 0) return null;

  const pull = async (name: string) => {
    if (pulling) return;
    setPulling(name);
    try {
      const blob = await downloadCloudFile(user.id, name);
      if (!blob) throw new Error("Download returned no data");
      await ctx.onSaveFile(name, blob);
      await markPushed(name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to pull ${name}`);
    } finally {
      setPulling(null);
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-border space-y-1">
      <p className="px-1 text-xs text-muted-foreground">Available in cloud</p>
      {onlyInCloud.map((name) => (
        <div key={name} className="flex items-center gap-2 p-2 rounded-md text-muted-foreground">
          <span className="flex-1 min-w-0 text-sm font-mono truncate">{name}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-70 hover:opacity-100"
            onClick={() => pull(name)}
            disabled={pulling !== null}
            title="Download from cloud"
          >
            {pulling === name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
          </Button>
        </div>
      ))}
    </div>
  );
}
