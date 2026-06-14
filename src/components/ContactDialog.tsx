import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

// eslint-disable-next-line react-refresh/only-export-components -- co-located with the dialog that owns the categories
export const MESSAGE_CATEGORIES = ["Comment", "Feature Request", "Complaint", "Bug Report"] as const;

// The category VALUE submitted to the backend stays the English string above;
// this only maps it to a locale key for display.
const CATEGORY_KEYS = {
  "Comment": "comment",
  "Feature Request": "featureRequest",
  "Complaint": "complaint",
  "Bug Report": "bugReport",
} as const;

export function ContactDialog({ variant = "footer" }: { variant?: "header" | "footer" }) {
  const { t } = useTranslation("landing");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/submit-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, email: email.trim() || null, message: message.trim() }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        toast({ title: t("contact.error"), description: data.error || t("contact.errorGeneric"), variant: "destructive" });
        return;
      }

      toast({ title: t("contact.sent"), description: t("contact.sentDesc") });
      setCategory("");
      setEmail("");
      setMessage("");
      setOpen(false);
    } catch {
      toast({ title: t("contact.error"), description: t("contact.errorNetwork"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "header" ? (
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
          <Button onClick={handleSubmit} disabled={submitting || !category || !message.trim()} className="w-full">
            {submitting ? t("contact.sending") : t("contact.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
