import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
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
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
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
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={null}>
            {enableCloud && <PendingCheckoutRedirect />}
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              {(enableAdmin || enableCloud) && <Route path="/login" element={<Login />} />}
              {enableAdmin && <Route path="/admin" element={<Admin />} />}
              {enableCloud && <Route path="/register" element={<Register />} />}
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
  );
};

export default App;
