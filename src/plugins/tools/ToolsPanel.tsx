// The Tools tab body: a picker of available tools, and the opened tool with a
// back bar. Chromeless panel — it owns the full tab surface.

import { Suspense, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PluginPanelProps } from "@/plugins/panels";
import { TOOLS } from "./toolList";

export default function ToolsPanel(props: PluginPanelProps) {
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const activeTool = TOOLS.find((t) => t.id === activeToolId) ?? null;

  if (!activeTool) {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Tools</h2>
            <p className="text-xs text-muted-foreground">Trackside calculators and utilities.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveToolId(tool.id)}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <Icon className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                  <span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{tool.name}</span>
                      {tool.badge && (
                        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                          {tool.badge}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{tool.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const ToolBody = activeTool.component;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={() => setActiveToolId(null)}>
          <ChevronLeft className="w-4 h-4" />
          <span className="text-xs">Tools</span>
        </Button>
        <span className="text-sm font-medium text-foreground">{activeTool.name}</span>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<p className="p-4 text-xs text-muted-foreground">Loading tool…</p>}>
          <ToolBody {...props} />
        </Suspense>
      </div>
    </div>
  );
}
