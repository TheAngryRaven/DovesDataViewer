import { Wrench } from "lucide-react";

export function SetupsTab() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
      <Wrench className="w-12 h-12 opacity-30" />
      <p className="text-sm font-medium">Setups coming soon</p>
    </div>
  );
}
