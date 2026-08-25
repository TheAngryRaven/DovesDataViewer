import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Mail, Paperclip } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { submitContactMessage } from "@/lib/contactMessage";
import { MAX_UPLOAD_BYTES } from "@/lib/parseReport";

// The "request a new datalogger" category — exported so the logger picker can
// open this dialog with it preselected. Keep the VALUE in sync with the edge
// function's ALLOWED_CATEGORIES + the admin MessagesTab category map.
export const CATEGORY_NEW_DATALOGGER = "New Datalogger Connection";

// eslint-disable-next-line react-refresh/only-export-components -- co-located with the dialog that owns the categories
export const MESSAGE_CATEGORIES = ["Comment", "Feature Request", "Complaint", "Bug Report", CATEGORY_NEW_DATALOGGER] as const;

// The category VALUE submitted to the backend stays the English string above;
// this only maps it to a locale key for display.
const CATEGORY_KEYS = {
  "Comment": "comment",
  "Feature Request": "featureRequest",
  "Complaint": "complaint",
  "Bug Report": "bugReport",
  [CATEGORY_NEW_DATALOGGER]: "newDatalogger",
} as const;

export function ContactDialog({
  variant = "footer",
  trigger,
  defaultCategory,
  sessionFile,
}: {
  variant?: "header" | "footer";
  /** Custom trigger element (overrides the default header/footer button). */
  trigger?: ReactNode;
  /** Preselect a category when the dialog opens (e.g. from the logger picker). */
  defaultCategory?: string;
  /**
   * The currently-loaded session's datalog (plan 0013): when set, the dialog
   * offers a toggle to attach it to the message. The blob is fetched lazily
   * on submit so merely opening the dialog never touches IndexedDB.
   *
   * `getTrackData` (plan 0019) rides along on the same toggle: the track and
   * course the session was analysed against, which the datalog itself doesn't
   * carry. Also lazy, and optional — a session with no track just sends the log.
   */
  sessionFile?: {
    name: string;
    getBlob: () => Promise<Blob | null>;
    getTrackData?: () => Promise<{ blob: Blob; name: string } | null>;
  };
}) {
  const { t } = useTranslation("landing");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(defaultCategory ?? "");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [attachSession, setAttachSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the preselected category each time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && defaultCategory) setCategory(defaultCategory);
  };

  const handleSubmit = async () => {
    if (!category || !message.trim()) {
      toast({ title: t("contact.missingFields"), description: t("contact.missingFieldsDesc"), variant: "destructive" });
      return;
    }
    if (message.trim().length > 2000) {
      toast({ title: t("contact.tooLong"), description: t("contact.tooLongDesc"), variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      let attachment: { blob: Blob; name: string } | undefined;
      let trackAttachment: { blob: Blob; name: string } | undefined;
      if (attachSession && sessionFile) {
        const blob = await sessionFile.getBlob();
        if (!blob) {
          toast({ title: t("contact.error"), description: t("contact.attachMissing"), variant: "destructive" });
          return;
        }
        attachment = { blob, name: sessionFile.name };
        // The track is best-effort: a missing or unreadable one must never
        // block the report the user is actually trying to send.
        trackAttachment = (await sessionFile.getTrackData?.().catch(() => null)) ?? undefined;
      }

      const result = await submitContactMessage({ category, email, message, attachment, trackAttachment });
      if (!result.ok) {
        if (result.reason === "too-large") {
          toast({
            title: t("parseReport.tooLarge"),
            description: t("parseReport.tooLargeDesc", { max: Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)) }),
            variant: "destructive",
          });
        } else {
          toast({
            title: t("contact.error"),
            description:
              result.reason === "network"
                ? t("contact.errorNetwork")
                : result.serverError || t("contact.errorGeneric"),
            variant: "destructive",
          });
        }
        return;
      }

      toast({ title: t("contact.sent"), description: t("contact.sentDesc") });
      setCategory(defaultCategory ?? "");
      setEmail("");
      setMessage("");
      setAttachSession(false);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ? (
          trigger
        ) : variant === "header" ? (
          <Button variant="default" size="sm" className="gap-2">
            <Mail className="w-4 h-4" />
            <span className="hidden sm:inline">{t("contact.trigger")}</span>
          </Button>
        ) : (
          <button className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <Mail className="w-3 h-3" />
            {t("contact.trigger")}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("contact.title")}</DialogTitle>
          <DialogDescription>{t("contact.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>{t("contact.categoryLabel")}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder={t("contact.categoryPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {MESSAGE_CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>{t(`contact.categories.${CATEGORY_KEYS[c]}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("contact.emailLabel")} <span className="text-muted-foreground text-xs">{t("contact.emailOptional")}</span></Label>
            <Input
              type="email"
              placeholder={t("contact.emailPlaceholder")}
              value={email}
              onChange={e => setEmail(e.target.value)}
              maxLength={255}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("contact.messageLabel")}</Label>
            <Textarea
              placeholder={t("contact.messagePlaceholder")}
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={2000}
              rows={5}
            />
            <p className="text-xs text-muted-foreground text-right">{message.length}/2000</p>
          </div>
          {sessionFile && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <Label htmlFor="attach-session" className="flex min-w-0 cursor-pointer items-center gap-2 text-sm font-normal">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  {t("contact.attachSession")}{" "}
                  <span className="break-all font-mono text-xs text-muted-foreground">{sessionFile.name}</span>
                  {sessionFile.getTrackData && (
                    <span className="block text-xs text-muted-foreground">{t("contact.attachTrackHint")}</span>
                  )}
                </span>
              </Label>
              <Switch id="attach-session" checked={attachSession} onCheckedChange={setAttachSession} />
            </div>
          )}
          <Button onClick={handleSubmit} disabled={submitting || !category || !message.trim()} className="w-full">
            {submitting ? t("contact.sending") : t("contact.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
