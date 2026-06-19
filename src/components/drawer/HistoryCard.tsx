import { ArrowDown, ArrowUp, Trophy, Car, MapPin, ChevronDown, ChevronUp } from "lucide-react";
import { formatLapTime } from "@/lib/lapCalculation";
import type { SetupField, SetupFieldDiff, SetupUsage } from "@/lib/setupHistory";

/** A small kart/course pill rendered under the card header. */
export interface HistoryCardBubble {
  icon: "car" | "map";
  text: string;
}

/** Collapsible body toggle; omit to render the body without a control. */
export interface HistoryCardToggle {
  expanded: boolean;
  onToggle: () => void;
  expandLabel: string;
  collapseLabel: string;
}

interface HistoryCardProps {
  /** Highlights the card green when it holds the fastest lap in view. */
  isFastestOverall: boolean;
  /** Left header content — a badge (setup history) or the setup name (vehicle history). */
  header: React.ReactNode;
  /** Short content hash, rendered as #hash. */
  hash: string;
  /** Pre-formatted date string. */
  date: string;
  fastestLapMs: number | null;
  fastestTagLabel: string;
  noLapLabel: string;
  bubbles?: HistoryCardBubble[];
  /** Card body (full setup table or diff list); may be null when collapsed. */
  children?: React.ReactNode;
  toggle?: HistoryCardToggle;
  /** Sessions completed with this revision, fastest lap first. */
  usages: SetupUsage[];
  lapsHeaderLabel: string;
}

/**
 * Shared history card chrome for both the setup- and vehicle-history panels:
 * fastest-lap highlight, header (hash/date/fastest tag/lap time), kart/course
 * bubbles, a caller-supplied collapsible body, and the fastest-laps footer.
 */
export function HistoryCard({
  isFastestOverall,
  header,
  hash,
  date,
  fastestLapMs,
  fastestTagLabel,
  noLapLabel,
  bubbles,
  children,
  toggle,
  usages,
  lapsHeaderLabel,
}: HistoryCardProps) {
  const visibleBubbles = bubbles?.filter((b) => b.text) ?? [];
  return (
    <div
      className={`rounded-lg border p-3 space-y-2.5 ${
        isFastestOverall ? "border-success/60 bg-success/5" : "border-border"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {header}
            <span className="font-mono text-[10px] text-muted-foreground">#{hash}</span>
            <span className="text-[10px] text-muted-foreground">{date}</span>
            {isFastestOverall && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success/15 text-success">
                <Trophy className="w-3 h-3" /> {fastestTagLabel}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          {fastestLapMs !== null ? (
            <span className="font-mono text-sm font-semibold text-foreground">{formatLapTime(fastestLapMs)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{noLapLabel}</span>
          )}
        </div>
      </div>

      {/* Kart/course bubbles */}
      {visibleBubbles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleBubbles.map((b, i) => (
            <span
              key={`${b.icon}-${i}`}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {b.icon === "car" ? <Car className="w-3 h-3" /> : <MapPin className="w-3 h-3" />} {b.text}
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      {children}

      {/* Collapse/expand toggle */}
      {toggle && (
        <button
          type="button"
          onClick={toggle.onToggle}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {toggle.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {toggle.expanded ? toggle.collapseLabel : toggle.expandLabel}
        </button>
      )}

      {/* Fastest laps completed with this revision */}
      {usages.length > 0 && (
        <div className="pt-1.5 border-t border-border/60 space-y-0.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            {lapsHeaderLabel}
          </p>
          {usages.slice(0, 6).map((u) => (
            <div key={u.fileName} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground truncate">
                {[u.courseLabel, u.kartName].filter(Boolean).join(" · ") || u.fileName}
              </span>
              <span className="font-mono text-foreground shrink-0">
                {u.fastestLapMs !== undefined ? formatLapTime(u.fastestLapMs) : noLapLabel}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full flattened setup table — shared by both history panels. */
export function FullSetup({
  fields,
  labelFor,
  noDataLabel,
}: {
  fields: SetupField[];
  labelFor: (f: { label?: string; labelKey?: string }) => string;
  noDataLabel: string;
}) {
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">{noDataLabel}</p>;
  }
  return (
    <div className="space-y-0.5">
      {fields.map((f) => (
        <div key={f.key} className="flex justify-between gap-2 text-xs">
          <span className="text-muted-foreground truncate">{labelFor(f)}</span>
          <span className="font-mono text-foreground shrink-0">
            {f.display}{f.unit ? ` ${f.unit}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Changed-fields-only diff list — used by the setup-history panel. */
export function DiffList({
  diff,
  labelFor,
}: {
  diff: SetupFieldDiff[];
  labelFor: (f: { label?: string; labelKey?: string }) => string;
}) {
  return (
    <div className="space-y-0.5">
      {diff.map((d) => {
        const color =
          d.direction === "up" ? "text-success" : d.direction === "down" ? "text-destructive" : "text-foreground";
        const Arrow = d.direction === "up" ? ArrowUp : d.direction === "down" ? ArrowDown : null;
        return (
          <div key={d.key} className="flex justify-between gap-2 text-xs items-center">
            <span className="text-muted-foreground truncate">{labelFor(d)}</span>
            <span className="flex items-center gap-1 font-mono shrink-0">
              {d.prevDisplay !== null && (
                <span className="text-muted-foreground/70 line-through decoration-muted-foreground/40">
                  {d.prevDisplay}
                </span>
              )}
              <span className={`flex items-center gap-0.5 ${color}`}>
                {Arrow && <Arrow className="w-3 h-3" />}
                {d.nextDisplay !== null ? `${d.nextDisplay}${d.unit ? ` ${d.unit}` : ""}` : "—"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
