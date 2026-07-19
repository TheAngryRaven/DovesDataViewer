import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { shareToken, shareUrl } from "./shareState";
import type { Shareability } from "./sessionShare";

// Share modal for one cloud-synced log (plan 0009). The public/private switch
// reflects the file's live share state (a token on its cloud index row); turning
// it on publishes + reveals the copyable /s/{token} URL, turning it off retires
// the link (and pins an opt-out so auto-publish can't resurrect it). All
// Supabase-touching work goes through dynamic imports of sessionShare.

interface ShareSessionDialogProps {
  fileName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ShareSessionDialog({ fileName, open, onOpenChange }: ShareSessionDialogProps) {
  const { t } = useTranslation("plugins");
  const { user } = useAuth();
  const online = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [shareability, setShareability] = useState<Shareability | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    setLoading(true);
    setCopied(false);
    void (async () => {
      const { getShareState, describeShareability } = await import("./sessionShare");
      const [state, able] = await Promise.all([
        getShareState(user.id, fileName),
        describeShareability(fileName),
      ]);
      if (!active) return;
      setToken(shareToken(state));
      setShareability(able);
      setLoading(false);
    })().catch(() => {
      if (!active) return;
      setLoading(false);
      toast.error(t("share.loadStateFailed"));
    });
    return () => {
      active = false;
    };
  }, [open, user, fileName, t]);

  const setPublic = useCallback(
    async (next: boolean) => {
      if (!user || busy) return;
      setBusy(true);
      try {
        const mod = await import("./sessionShare");
        if (next) {
          const { token: fresh } = await mod.shareSession(user.id, fileName);
          setToken(fresh);
        } else {
          await mod.unshareSession(user.id, fileName);
          setToken(null);
        }
      } catch {
        toast.error(next ? t("share.shareFailed") : t("share.unshareFailed"));
      } finally {
        setBusy(false);
      }
    },
    [user, busy, fileName, t],
  );

  const url = token ? shareUrl(window.location.origin, token) : null;

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("share.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("share.copyFailed"));
    }
  }, [url, t]);

  // Unshareable only blocks NEW shares — an existing link can always be retired.
  const cannotShare = !token && shareability !== null && !shareability.hasCourse;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("share.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("share.dialogDescription")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="share-public" className="text-sm">
                {t("share.publicToggle")}
              </Label>
              <div className="flex items-center gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Switch
                  id="share-public"
                  checked={!!token}
                  disabled={busy || !online || cannotShare}
                  onCheckedChange={(v) => void setPublic(v)}
                />
              </div>
            </div>

            {!online && <p className="text-xs text-muted-foreground">{t("share.offline")}</p>}
            {cannotShare && <p className="text-xs text-warning">{t("share.noCourse")}</p>}

            {url && (
              <div className="space-y-1.5">
                <Label htmlFor="share-url" className="text-xs text-muted-foreground">
                  {t("share.linkLabel")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input id="share-url" readOnly value={url} className="h-8 text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => void copyLink()} aria-label={t("share.copy")}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">{t("share.privacyNote")}</p>
            {shareability?.isUserDefined && (
              <p className="text-xs text-muted-foreground">{t("share.customCourseNote")}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
