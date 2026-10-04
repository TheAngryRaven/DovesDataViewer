import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import {
  clearNativeVideoStore,
  listNativeStoredVideos,
  removeNativeStoredVideo,
  NATIVE_VIDEO_STORE_CHANGED,
  type NativeStoredVideoEntry,
} from "@/lib/nativeVideoStore";
import {
  formatVideoBytes,
  sessionLabel,
  sortDeviceVideos,
  totalDeviceVideoBytes,
  withoutRemoved,
} from "./deviceVideos";

function formatDate(ms?: number): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Sentinel key for the clear-all confirmation/busy state. */
const ALL = "*";

// Profile-tab panel (native shell only): the videos the shell keeps so a
// session can reload its video — listed with sizes, deletable one at a time
// or all at once. Deleting only forgets the app's copy; the original file on
// the phone is untouched. A session playing from a deleted copy unloads
// itself (useVideoSync listens for the same store-changed event).
export default function DeviceVideosPanel(_props: PluginPanelProps) {
  const { t } = useTranslation("plugins");
  // undefined = loading; null = this shell can't list (it predates the command).
  const [entries, setEntries] = useState<NativeStoredVideoEntry[] | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setEntries(await listNativeStoredVideos());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-list whenever the store changes — our own deletions included, and a
  // session load elsewhere replacing its video.
  useEffect(() => {
    const onChanged = () => void refresh();
    window.addEventListener(NATIVE_VIDEO_STORE_CHANGED, onChanged);
    return () => window.removeEventListener(NATIVE_VIDEO_STORE_CHANGED, onChanged);
  }, [refresh]);

  const report = (err: unknown) =>
    toast.error(t("deviceVideos.failed", { error: err instanceof Error ? err.message : String(err) }));

  const handleRemove = async (key: string) => {
    setBusy(key);
    try {
      const freed = await removeNativeStoredVideo(key);
      setEntries((prev) => (prev ? withoutRemoved(prev, [key]) : prev));
      toast.success(t("deviceVideos.removed", { size: formatVideoBytes(freed) }));
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
      setConfirmKey(null);
    }
  };

  const handleClear = async () => {
    setBusy(ALL);
    try {
      const freed = await clearNativeVideoStore();
      setEntries([]);
      toast.success(t("deviceVideos.cleared", { size: formatVideoBytes(freed) }));
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
      setConfirmKey(null);
    }
  };

  if (entries === undefined) {
    return <p className="text-xs text-muted-foreground">{t("loading")}</p>;
  }
  if (entries === null) {
    return <p className="text-xs text-muted-foreground">{t("deviceVideos.unavailable")}</p>;
  }

  const sorted = sortDeviceVideos(entries);
  const total = totalDeviceVideoBytes(entries);
  const clearing = busy === ALL;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("deviceVideos.note")}</p>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("deviceVideos.empty")}</p>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">
            {t("deviceVideos.summary", { count: sorted.length, size: formatVideoBytes(total) })}
          </p>

          <ul className="divide-y divide-border rounded-md border border-border">
            {sorted.map((e) => {
              const session = sessionLabel(e);
              const date = formatDate(e.storedAtMs);
              const confirming = confirmKey === e.key;
              const working = busy === e.key || clearing;
              return (
                <li key={e.key} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{e.fileName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {session ?? t("deviceVideos.unknownSession")}
                        {" · "}
                        {formatVideoBytes(e.size)}
                        {date && ` · ${t("deviceVideos.storedOn", { date })}`}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      title={t("deviceVideos.remove")}
                      disabled={working || confirming}
                      onClick={() => setConfirmKey(e.key)}
                    >
                      {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                  {confirming && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs">
                      <span>{t("deviceVideos.confirmRemove")}</span>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={working} onClick={() => setConfirmKey(null)}>
                          {t("deviceVideos.cancel")}
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={working} onClick={() => void handleRemove(e.key)}>
                          {t("deviceVideos.remove")}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {confirmKey === ALL ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs">
              <span>{t("deviceVideos.confirmClear", { count: sorted.length })}</span>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={clearing} onClick={() => setConfirmKey(null)}>
                  {t("deviceVideos.cancel")}
                </Button>
                <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={clearing} onClick={() => void handleClear()}>
                  {clearing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  {t("deviceVideos.clearAll")}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => setConfirmKey(ALL)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("deviceVideos.clearAll")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
