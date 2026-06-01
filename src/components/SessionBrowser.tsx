import { Fragment } from "react";
import { Folder, ChevronRight } from "lucide-react";
import type { BrowserView, BrowserSession, FilterMode, NavState } from "@/lib/fileBrowserTree";

const FILTER_LABELS: Record<FilterMode, string> = { none: "None", engine: "Engine", kart: "Kart" };

interface SessionBrowserProps {
  /** The resolved view to render (from `computeBrowserView`). */
  view: BrowserView;
  /** Apply a navigation (breadcrumb click, folder open, or filter change). */
  onNavigate: (nav: NavState) => void;
  /** Render one log row (the caller owns row chrome + actions). */
  renderRow: (session: BrowserSession) => React.ReactNode;
  emptyText?: string;
}

/**
 * Presentational Track→Course→logs browser: breadcrumb + optional Engine/Kart
 * filter + folders + the caller-rendered log rows. Pure UI over a computed
 * `BrowserView` — shared by the Files tab and the Profile cloud-logs panel.
 */
export function SessionBrowser({ view, onNavigate, renderRow, emptyText = "No sessions here" }: SessionBrowserProps) {
  return (
    <div className="space-y-1">
      {/* Breadcrumb — always shown so date-named logs read in context. */}
      <div className="flex items-center flex-wrap gap-0.5 px-1 pb-1 text-sm">
        {view.breadcrumb.map((seg, i) => {
          const isLast = i === view.breadcrumb.length - 1;
          return (
            <Fragment key={`${seg.label}-${i}`}>
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              <button
                type="button"
                disabled={isLast}
                onClick={() => onNavigate(seg.nav)}
                className={isLast
                  ? "font-semibold text-foreground truncate"
                  : "text-muted-foreground hover:text-foreground truncate"}
              >
                {seg.label}
              </button>
            </Fragment>
          );
        })}
      </div>

      {/* Engine/Kart filter — only on the final log level. */}
      {view.showFilter && (
        <div className="flex items-center gap-2 px-1 pb-1">
          <span className="text-xs text-muted-foreground">Group by</span>
          <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
            {(["none", "engine", "kart"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  // Keep the resolved track/course; clear any drilled-in folder.
                  const last = view.breadcrumb[view.breadcrumb.length - 1].nav;
                  onNavigate({ track: last.track, course: last.course, filter: mode });
                }}
                className={`px-2.5 py-0.5 text-xs font-medium rounded transition-colors ${
                  view.filterMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {FILTER_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Folders */}
      {view.folders.map((folder) => (
        <button
          key={`${folder.kind}-${folder.key}`}
          type="button"
          onClick={() => onNavigate(folder.nav)}
          className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors text-left"
        >
          <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="flex-1 text-sm font-medium text-foreground truncate">{folder.label}</span>
          <span className="text-xs text-muted-foreground shrink-0">{folder.count}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      ))}

      {/* Logs (final list, or unconfigured logs below filter folders) */}
      {view.sessions.map((s) => (
        <Fragment key={s.fileName}>{renderRow(s)}</Fragment>
      ))}

      {view.folders.length === 0 && view.sessions.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">{emptyText}</p>
      )}
    </div>
  );
}
