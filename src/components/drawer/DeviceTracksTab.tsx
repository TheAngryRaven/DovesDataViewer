import { Construction } from "lucide-react";

export function DeviceTracksTab() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3 text-center">
      <Construction className="w-10 h-10 text-muted-foreground" />
      <h3 className="font-semibold text-foreground">Track Manager</h3>
      <p className="text-sm text-muted-foreground">Work in Progress</p>
      <p className="text-xs text-muted-foreground max-w-[240px]">
        Manage tracks stored on your DovesDataLogger device. Coming soon!
      </p>
    </div>
  );
}
