import { memo } from "react";
import { FlaskConical } from "lucide-react";

export const LabsTab = memo(function LabsTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center space-y-2">
        <FlaskConical className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground">No new experiments</p>
      </div>
    </div>
  );
});
