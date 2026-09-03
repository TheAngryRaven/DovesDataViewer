import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorPanel } from "@/components/loggers/DownloadPanels";
import { classifyLoggerError, loggerErrorKey } from "@/lib/loggers/errors";
import {
  insta360Connect,
  insta360Disconnect,
  insta360ListFiles,
  insta360Status,
} from "@/lib/insta360/ipc";
import type { Insta360CameraFile, Insta360CameraInfo } from "@/lib/insta360/types";

interface Insta360ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stream this recording into the player. */
  onLoad: (file: Insta360CameraFile) => void;
  /** The camera was disconnected on purpose — a stream from it is over. */
  onDisconnected: () => void;
}

type Phase = "idle" | "connecting" | "listing" | "ready" | "error";

/** Insta360 cameras ship with this hotspot password. */
const DEFAULT_PASSPHRASE = "88888888";

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatWhen(file: Insta360CameraFile, locale: string): string | null {
  const iso = file.recordedAt ?? (file.createdAtMs > 0 ? new Date(file.createdAtMs).toISOString() : null);
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Connect to an Insta360 camera over its Wi-Fi hotspot and pick a recording
 * to stream (plan 0025; LapWing `docs/insta360.md`). Native only — lazily
 * loaded by VideoPlayer, never part of the web bundle's eager graph.
 *
 * Closing the dialog keeps the camera connected: the stream needs it. Only
 * the explicit Disconnect button drops the camera (and the stream with it).
 */
export function Insta360ImportDialog({ open, onOpenChange, onLoad, onDisconnected }: Insta360ImportDialogProps) {
  const { t, i18n } = useTranslation("video");
  const { t: tLogger } = useTranslation("logger");
  const [phase, setPhase] = useState<Phase>("idle");
  const [camera, setCamera] = useState<Insta360CameraInfo | null>(null);
  const [files, setFiles] = useState<Insta360CameraFile[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [ssidPrefix, setSsidPrefix] = useState("");
  const [passphrase, setPassphrase] = useState(DEFAULT_PASSPHRASE);

  // Reopening the dialog while a camera is still connected (a stream is
  // playing) resumes at the recording list.
  useEffect(() => {
    if (!open || phase !== "idle") return;
    let alive = true;
    void insta360Status()
      .then(async (s) => {
        if (!alive || !s.connected || !s.camera) return;
        setCamera(s.camera);
        setPhase("listing");
        setFiles(await insta360ListFiles());
        if (alive) setPhase("ready");
      })
      .catch(() => { /* not connected — stay idle */ });
    return () => { alive = false; };
  }, [open, phase]);

  const connect = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      const info = await insta360Connect("wifi", {
        ssidPrefix: ssidPrefix.trim() || "*",
        passphrase: passphrase || undefined,
      });
      setCamera(info);
      setPhase("listing");
      setFiles(await insta360ListFiles());
      setPhase("ready");
    } catch (err) {
      setError(err);
      setPhase("error");
    }
  }, [ssidPrefix, passphrase]);

  const refresh = useCallback(async () => {
    setPhase("listing");
    try {
      setFiles(await insta360ListFiles());
      setPhase("ready");
    } catch (err) {
      setError(err);
      setPhase("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    await insta360Disconnect();
    setCamera(null);
    setFiles([]);
    setPhase("idle");
    onDisconnected();
  }, [onDisconnected]);

  const classified = error != null ? classifyLoggerError(error) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            {t("insta360.title")}
          </DialogTitle>
          <DialogDescription>{t("insta360.intro")}</DialogDescription>
        </DialogHeader>

        {phase === "idle" && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="insta360-ssid">{t("insta360.ssidPrefix")}</Label>
              <Input
                id="insta360-ssid"
                value={ssidPrefix}
                onChange={(e) => setSsidPrefix(e.target.value)}
                placeholder="X4"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{t("insta360.ssidPrefixHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="insta360-pass">{t("insta360.passphrase")}</Label>
              <Input
                id="insta360-pass"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{t("insta360.passphraseHint")}</p>
            </div>
            <Button onClick={() => void connect()} className="gap-2">
              <Camera className="w-4 h-4" /> {t("insta360.connect")}
            </Button>
          </div>
        )}

        {(phase === "connecting" || phase === "listing") && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            {phase === "connecting" ? t("insta360.connecting") : t("insta360.listing")}
          </div>
        )}

        {phase === "error" && classified && (
          <ErrorPanel
            message={tLogger(loggerErrorKey(classified.category))}
            detail={classified.detail}
            detailLabel={tLogger("errors.detailLabel")}
            onCancel={() => { setError(null); setPhase("idle"); }}
            cancelLabel={t("insta360.back")}
            onAction={() => void connect()}
            actionLabel={tLogger("errors.actionRetry")}
          />
        )}

        {phase === "ready" && (
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground truncate">
                {t("insta360.connected", { camera: camera?.cameraType ?? "Insta360" })}
              </span>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => void refresh()}>{t("insta360.refresh")}</Button>
                <Button variant="ghost" size="sm" onClick={() => void disconnect()} className="gap-1">
                  <Unplug className="w-3.5 h-3.5" /> {t("insta360.disconnect")}
                </Button>
              </div>
            </div>
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("insta360.noRecordings")}</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-thin flex flex-col gap-2">
                {files.map((f) => {
                  const when = formatWhen(f, i18n.language);
                  return (
                    <div key={f.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{f.name}</span>
                          {f.is360 && (
                            <span className="text-[10px] font-semibold rounded bg-primary/15 text-primary px-1.5 py-0.5">
                              {t("insta360.badge360")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {when ? `${when} · ` : ""}{formatDuration(f.durationMs)}
                          {f.width > 0 ? ` · ${f.width}×${f.height}` : ""}
                          {f.segmentCount > 1 ? ` · ${t("insta360.segments", { count: f.segmentCount })}` : ""}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => { onLoad(f); onOpenChange(false); }}>
                        {t("insta360.load")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
