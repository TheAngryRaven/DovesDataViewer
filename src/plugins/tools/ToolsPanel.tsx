// The Tools tab body: a picker of available tools, and the opened tool with a
// back bar. Chromeless panel — it owns the full tab surface.

import { Suspense, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PluginPanelProps } from "@/plugins/panels";
import { TOOLS } from "./toolList";
import { useToolsT } from "./i18n";

export default function ToolsPanel(props: PluginPanelProps) {
  const t = useToolsT();
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const activeTool = TOOLS.find((tool) => tool.id === activeToolId) ?? null;

  if (!activeTool) {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t("picker.heading")}</h2>
            <p className="text-xs text-muted-foreground">{t("picker.subtitle")}</p>
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
                      <span className="text-sm font-medium text-foreground">{t(tool.nameKey)}</span>
                      {tool.badgeKey && (
                        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                          {t(tool.badgeKey)}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{t(tool.descriptionKey)}</span>
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
          <span className="text-xs">{t("picker.back")}</span>
        </Button>
        <span className="text-sm font-medium text-foreground">{t(activeTool.nameKey)}</span>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<p className="p-4 text-xs text-muted-foreground">{t("picker.loadingTool")}</p>}>
          <ToolBody {...props} />
        </Suspense>
      </div>
    </div>
  );
}
