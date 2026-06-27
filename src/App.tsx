import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { FileLoadingOverlay } from "@/components/FileLoadingOverlay";
import { DebugConsole } from "@/components/DebugConsole";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { AuthProvider } from "@/contexts/AuthContext";
import { isNativeApp } from "@/lib/platform";
import { MigrationBanner } from "@/components/MigrationBanner";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';
const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';

// Lazy-load secondary routes. Auth pages (Login/Register/Forgot/Reset/Callback)
// only mount when their gating flag is on, so a flag-off build never ships
// their chunks — preserving the offline-first invariant.
const Login = lazy(() => import("./pages/Login"));
const Admin = lazy(() => import("./pages/Admin"));
const Register = lazy(() => import("./pages/Register"));
const Leaderboards = lazy(() => import("./pages/Leaderboards"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
// Public, no-login account-deletion request page. Mounted un-gated (below) so the
// URL Google Play requires resolves on every build, even offline-only ones.
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const PendingCheckoutRedirect = lazy(() =>
  import("./components/PendingCheckoutRedirect").then((m) => ({ default: m.PendingCheckoutRedirect })),
);

const SETTINGS_KEY = "dove-dataviewer-settings";

const App = () => {
  // Apply dark/light mode globally so Admin and all routes respect the theme
  useEffect(() => {
    const apply = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        const dark = stored ? JSON.parse(stored).darkMode : false;
        document.documentElement.classList.toggle('dark', !!dark);
      } catch { /* malformed settings; fall through to default light mode */ }
    };
    apply();
    window.addEventListener('storage', apply);
    return () => window.removeEventListener('storage', apply);
  }, []);

  return (
  <I18nextProvider i18n={i18n}>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <FileLoadingOverlay />
        <DebugConsole />
        <BrowserRouter>
          {/* Old-domain-only migration notice (hackthetrack.net → lapwingdata.com).
              Renders nothing on the new site. Inside the router so it can navigate. */}
          <MigrationBanner />
          <Suspense fallback={null}>
            {enableCloud && !isNativeApp() && <PendingCheckoutRedirect />}
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              {/* Un-gated: Google Play requires a publicly reachable account-deletion
                  URL. The page itself adapts when cloud accounts are disabled. */}
              <Route path="/delete-account" element={<DeleteAccount />} />
              {(enableAdmin || enableCloud) && <Route path="/login" element={<Login />} />}
              {enableAdmin && <Route path="/admin" element={<Admin />} />}
              {enableCloud && <Route path="/register" element={<Register />} />}
              {enableCloud && <Route path="/leaderboards" element={<Leaderboards />} />}
              {enableCloud && <Route path="/forgot-password" element={<ForgotPassword />} />}
              {enableCloud && <Route path="/reset-password" element={<ResetPassword />} />}
              {enableCloud && <Route path="/auth/callback" element={<AuthCallback />} />}
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </I18nextProvider>
  );
};

export default App;
