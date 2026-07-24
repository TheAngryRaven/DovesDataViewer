// Shared tool-form primitives, lifted from the seat-position tool so every
// calculator gets the same committed-number-input behaviour and section chrome.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Number field that doesn't fight the keyboard: commits parseable input, resyncs on outside change. */
export function NumRow({ label, value, onChange, unit, step = 1, className }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  className?: string;
}) {
  const display = useMemo(() => String(Number(value.toFixed(2))), [value]);
  const [text, setText] = useState(display);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(display);
  }, [display]);
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">
        {label}
        {unit ? ` (${unit})` : ""}
      </Label>
      <NumberInput
        className="h-8 mt-1 text-sm"
        step={step}
        value={text}
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
          setText(display);
        }}
        onValueChange={(raw) => {
          setText(raw);
          const v = parseFloat(raw);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}

export function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground">
        {title}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border p-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
