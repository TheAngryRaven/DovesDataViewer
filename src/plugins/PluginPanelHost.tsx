import { Component, Suspense, useMemo, type ReactNode } from "react";
import { getPanelsForSlot, isBareSlot, type PluginPanelProps } from "./panels";

/**
 * Isolates a single plugin panel: a throw in one panel renders a local notice
 * instead of taking down the tab (or the app). Plugin UI is untrusted-ish —
 * first-party today, potentially user-installed later — so each gets a boundary.
 */
class PanelErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-muted-foreground">
          The “{this.props.title}” panel hit an error and was unloaded.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Mounts every plugin panel registered for `slot`, passing each the live
 * session snapshot. Renders `fallback` when no panels target the slot.
 */
export function PluginPanelHost({
  slot,
  fallback,
  ...props
}: { slot: string; fallback?: ReactNode } & PluginPanelProps) {
  const panels = useMemo(() => getPanelsForSlot(slot), [slot]);

  if (panels.length === 0) return <>{fallback ?? null}</>;

  // A fully-chromeless slot drops the host's outer padding/spacing so the panel
  // can fill the tab; a mixed/chromed slot keeps the padded, stacked layout.
  const bare = isBareSlot(panels);

  return (
    <div className={bare ? "h-full overflow-auto" : "h-full overflow-auto p-4 space-y-4"}>
      {panels.map((panel) => {
        const Icon = panel.icon;
        const Body = panel.component;

        const body = (
          <PanelErrorBoundary title={panel.title}>
            <Suspense fallback={<p className="text-xs text-muted-foreground">Loading…</p>}>
              <Body {...props} />
            </Suspense>
          </PanelErrorBoundary>
        );

        // Chromeless: render the body directly, letting the panel own its layout.
        if (panel.chromeless) return <div key={panel.id} className="h-full">{body}</div>;

        return (
          <section key={panel.id} className="rounded-lg border border-border bg-card">
            <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              {Icon && <Icon className="w-4 h-4 text-primary" />}
              <h3 className="text-sm font-medium text-foreground">{panel.title}</h3>
            </header>
            <div className="p-4">{body}</div>
          </section>
        );
      })}
    </div>
  );
}
