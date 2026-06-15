import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Engine } from "@/lib/engineStorage";
import {
  engineNameKey,
  filterEngines,
  normalizeEngineName,
  shouldOfferCreate,
} from "@/lib/engineUtils";

interface EngineComboboxProps {
  value: string;
  onChange: (value: string) => void;
  engines: Engine[];
  /** Persist a new engine name to the reusable list. */
  onCreate: (name: string) => Promise<unknown> | void;
  /** Remove a saved engine from the reusable list. */
  onDelete: (id: string) => Promise<void> | void;
  /** Engine names currently used by a vehicle — deletion is blocked for these. */
  usedNames?: string[];
  label?: string;
}

export function EngineCombobox({
  value,
  onChange,
  engines,
  onCreate,
  onDelete,
  usedNames = [],
  label,
}: EngineComboboxProps) {
  const { t } = useTranslation("drawer");
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const matches = filterEngines(engines, value);
  const offerCreate = shouldOfferCreate(value, engines);

  const usedKeys = new Set(usedNames.map(engineNameKey));

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const create = async () => {
    const name = normalizeEngineName(value);
    if (!name) return;
    await onCreate(name);
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="space-y-1" ref={wrapRef}>
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label ?? t("engine.label")}</Label>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setManageOpen(true)}
        >
          {t("engine.manage")}
        </button>
      </div>

      <div className="relative">
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter" && offerCreate) {
              e.preventDefault();
              create();
            }
          }}
          placeholder={t("engine.placeholder")}
          className="h-8 text-sm"
        />

        {open && (matches.length > 0 || offerCreate) && (
          <div className="absolute z-50 bottom-full mb-1 w-full max-h-44 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1">
            {matches.map((engine) => (
              <button
                key={engine.id}
                type="button"
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted/60 transition-colors truncate"
                onClick={() => pick(engine.name)}
              >
                {engine.name}
              </button>
            ))}
            {offerCreate && (
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm text-primary hover:bg-muted/60 transition-colors"
                onClick={create}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t("engine.create", { name: normalizeEngineName(value) })}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings className="w-4 h-4" /> {t("engine.manageTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("engine.manageDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {engines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("engine.empty")}</p>
            ) : (
              filterEngines(engines, "").map((engine) => {
                const inUse = usedKeys.has(engineNameKey(engine.name));
                return (
                  <div
                    key={engine.id}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex-1 min-w-0 truncate text-sm text-foreground">{engine.name}</span>
                    {inUse && <span className="text-[11px] text-muted-foreground shrink-0">{t("engine.inUse")}</span>}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive disabled:opacity-25 disabled:hover:text-current"
                      disabled={inUse}
                      title={inUse ? t("engine.inUseTitle") : t("engine.delete")}
                      onClick={() => onDelete(engine.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
