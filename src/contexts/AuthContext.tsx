import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string, captchaToken?: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The Supabase auth bootstrap only exists when an account-facing feature is
// on. Flag-off builds never load the backend chunk, keeping vendor-supabase
// entirely off the offline-first initial path (it was the single biggest dead
// weight on the landing page). The dynamic import starts at module evaluation
// on flag-on builds, so it's in flight before the provider even mounts.
const enableAuthBackend =
  import.meta.env.VITE_ENABLE_ADMIN === 'true' || import.meta.env.VITE_ENABLE_CLOUD === 'true';

const backendPromise = enableAuthBackend ? import('./authBackend') : null;

const disabledError = () =>
  Promise.resolve({ error: new Error('Accounts are not enabled in this build') });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Flag-off builds are immediately "settled signed-out"; flag-on builds stay
  // loading until the backend chunk reports the initial session.
  const [loading, setLoading] = useState(enableAuthBackend);

  useEffect(() => {
    if (!backendPromise) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    backendPromise.then((backend) => {
      if (cancelled) return;
      unsubscribe = backend.subscribeAuthState({ setUser, setSession, setIsAdmin, setLoading });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    session,
    isAdmin,
    loading,
    // Actions await the backend chunk, so a click racing the initial load
    // still lands on the real implementation.
    login: backendPromise
      ? async (email, password) => (await backendPromise).login(email, password)
      : disabledError,
    signUp: backendPromise
      ? async (email, password, displayName, captchaToken) =>
          (await backendPromise).signUp(email, password, displayName, captchaToken)
      : disabledError,
    logout: backendPromise
      ? async () => (await backendPromise).logout()
      : async () => {},
    resetPassword: backendPromise
      ? async (email) => (await backendPromise).resetPassword(email)
      : disabledError,
  }), [user, session, isAdmin, loading]);

  return (
    <AuthContext.Provider value={value}>
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
