import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string, captchaToken?: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
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
      redirectTo: window.location.origin + '/reset-password',
    });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string, captchaToken?: string) => {
    const trimmed = displayName?.trim();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + '/auth/callback',
        // Picked up by the handle_new_user trigger; blank → a random name is
        // generated server-side. A taken name is auto-suffixed there too.
        data: trimmed ? { display_name: trimmed } : {},
        // Verified server-side when Turnstile is enabled in the Supabase Auth
        // settings; ignored otherwise (graceful fallback when no key is set).
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    return { error };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    try {
      // Lazy import keeps the Lovable auth SDK out of the main chunk; this
      // module is only imported in cloud-flagged builds, but the dynamic
      // import doubles as belt-and-suspenders.
      const { lovable } = await import('@/integrations/lovable/index');
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin + '/auth/callback',
      });
      if (result.error) return { error: result.error as Error };
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, loading, login, signUp, signInWithGoogle, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- useAuth hook is conventionally co-located with AuthProvider
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
