import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Cloud, CloudDownload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { FileManagerSectionContext } from "@/plugins/mounts";
import { cloudOnlyNames, markPushed } from "./fileSync";
import { listCloudFiles, downloadCloudFile, type CloudFile } from "./syncEngine";

/**
 * Inventory of every file in the user's cloud. Files already on this device are
 * shown as present; files that aren't local get a per-file pull. Pulled files
 * persist via `ctx.onSaveFile` (which refreshes the list), so they flip to
 * "on this device" automatically.
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
  const files = cloud ?? [];
  const pullable = useMemo(
    () => new Set(cloudOnlyNames((cloud ?? []).map((c) => c.name), localNames)),
    [cloud, localNames],
  );

  if (!user || files.length === 0) return null;

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
    <div className="mb-2 pb-2 border-b border-border space-y-1">
      <p className="px-1 text-xs text-muted-foreground">Cloud files ({files.length})</p>
      {files.map((c) => {
        const canPull = pullable.has(c.name);
        return (
          <div key={c.name} className="flex items-center gap-2 p-2 rounded-md text-muted-foreground">
            <span className="flex-1 min-w-0 text-sm font-mono truncate">{c.name}</span>
            {canPull ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-70 hover:opacity-100"
                onClick={() => pull(c.name)}
                disabled={pulling !== null}
                title="Download from cloud"
              >
                {pulling === c.name ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudDownload className="w-3.5 h-3.5" />
                )}
              </Button>
            ) : (
              <span className="shrink-0 px-1" title="On this device">
                <Cloud className="w-3.5 h-3.5 text-primary" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
