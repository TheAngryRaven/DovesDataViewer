import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PinPromptContext } from "@/lib/ble";

interface LoggerPinDialogProps {
  /** The open prompt, or null when none is pending. */
  request: PinPromptContext | null;
  /** Called once per prompt: the entered PIN, or null on cancel. */
  onDone: (pin: string | null) => void;
}

/**
 * Asks for a logger's 4-digit PIN during a remote transfer start (plan 0031).
 * The PIN is only needed the first time — the app remembers it per logger.
 */
export function LoggerPinDialog({ request, onDone }: LoggerPinDialogProps) {
  const { t } = useTranslation("drawer");
  const [pin, setPin] = useState("");

  // Every prompt starts empty — a wrong PIN shouldn't sit there to be resent.
  useEffect(() => {
    if (request) setPin("");
  }, [request]);

  const valid = /^[0-9]{4}$/.test(pin);

  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open) onDone(null); }}>
      <DialogContent className="max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onDone(pin);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pin.title", { name: request?.deviceName || t("pin.thisLogger") })}</DialogTitle>
            <DialogDescription>{t("pin.desc")}</DialogDescription>
          </DialogHeader>
          <Input
            className="my-4 text-center text-2xl tracking-[0.5em] font-mono"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            autoFocus
            value={pin}
            aria-label={t("pin.label")}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          />
          {request?.triesLeft !== undefined && (
            <p className="text-sm text-destructive mb-4">{t("pin.wrong", { count: request.triesLeft })}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>{t("pin.cancel")}</Button>
            <Button type="submit" disabled={!valid}>{t("pin.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
