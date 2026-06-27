import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Shared "← back to home" link for the off-session pages (Leaderboards, driver profiles). */
export function BackToHome({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`gap-1.5 px-2 text-muted-foreground ${className ?? ""}`}
      onClick={() => navigate("/")}
    >
      <ArrowLeft className="h-4 w-4" />
      {t("actions.backToHome")}
    </Button>
  );
}
