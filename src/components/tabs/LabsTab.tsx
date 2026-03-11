import { memo } from "react";
import { FlaskConical } from "lucide-react";

export const LabsTab = memo(function LabsTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <FlaskConical className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">Labs Features</p>
        <p className="text-xs text-muted-foreground">
          Nothing cooking right now — check back later!
        </p>
      </div>
    </div>
  );
});
