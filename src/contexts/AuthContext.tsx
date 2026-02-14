import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let initialResolved = false;

    const updateAuth = async (s: Session | null) => {
      if (cancelled) return;
      try {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          const { data } = await supabase.rpc('has_role', {
            _user_id: s.user.id,
            _role: 'admin',
          });
          if (!cancelled) setIsAdmin(!!data);
        } else {
          setIsAdmin(false);
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
      if (!cancelled) {
        initialResolved = true;
        setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (cancelled) return;
        updateAuth(session);
      }
    );

    // Fallback: getSession as backup for initial load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialResolved) updateAuth(session);
    }).catch(() => {
      if (!cancelled && !initialResolved) {
        initialResolved = true;
        setLoading(false);
      }
    });

    // Safety timeout: never stay loading forever
    const timeout = setTimeout(() => {
      if (!initialResolved && !cancelled) {
        console.warn('Auth loading timed out');
        initialResolved = true;
        setLoading(false);
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login',
    });
    return { error };
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, loading, login, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
