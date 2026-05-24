import { Component, Suspense, useMemo, type ReactNode } from "react";
import { getMounts } from "./mounts";

/** Isolates a single mounted component so a plugin throw can't break core UI. */
class MountErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Renders every plugin component mounted at `slot`, passing each the given
 * context. Renders nothing when no plugin targets the slot, so it's safe to
 * drop into core UI unconditionally. Each component is error-boundaried and
 * Suspense-wrapped, so mounts may be `React.lazy`.
 */
export function PluginMount<C>({ slot, ctx }: { slot: string; ctx: C }) {
  const mounts = useMemo(() => getMounts<C>(slot), [slot]);
  if (mounts.length === 0) return null;
  return (
    <>
      {mounts.map((m) => {
        const Body = m.component;
        return (
          <MountErrorBoundary key={m.id}>
            <Suspense fallback={null}>
              <Body ctx={ctx} />
            </Suspense>
          </MountErrorBoundary>
        );
      })}
    </>
  );
}
