import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Lazy load admin pages only when VITE_ENABLE_ADMIN is set
const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';
const enableRegistration = import.meta.env.VITE_ENABLE_REGISTRATION === 'true';

import Login from "./pages/Login";
import Admin from "./pages/Admin";
import Register from "./pages/Register";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {enableAdmin && <Route path="/login" element={<Login />} />}
            {enableAdmin && <Route path="/admin" element={<Admin />} />}
            {enableRegistration && <Route path="/register" element={<Register />} />}
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
