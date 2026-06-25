/**
 * The Supabase-backed half of AuthContext, loaded as a separate chunk.
 *
 * This module owns the only auth-path static import of the Supabase client.
 * AuthContext dynamically imports it — and only when VITE_ENABLE_ADMIN or
 * VITE_ENABLE_CLOUD is on — so flag-off (pure offline-first) builds never
 * fetch vendor-supabase on the landing page at all, and flag-on builds load
 * it off the critical path.
 */

import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

export interface AuthStateListeners {
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Wire the Supabase auth state into React state. Returns an unsubscribe.
 */
export function subscribeAuthState(listeners: AuthStateListeners): () => void {
  const { setUser, setSession, setIsAdmin, setLoading } = listeners;
  let cancelled = false;
  let initialResolved = false;

  // Resolve the admin role. MUST run outside the onAuthStateChange callback:
  // supabase-js holds the GoTrue Web Lock (navigator.locks) for the duration
  // of that callback, and any awaited Supabase call inside it needs the same
  // lock — which deadlocks token refresh and spuriously signs the user out on
  // reload. So updateAuth sets session/user synchronously and defers this.
  const resolveRole = async (s: Session | null) => {
    if (!s?.user) {
      if (!cancelled) setIsAdmin(false);
      return;
    }
    try {
      const { data } = await supabase.rpc('has_role', {
        _user_id: s.user.id,
        _role: 'admin',
      });
      if (!cancelled) setIsAdmin(!!data);
    } catch {
      if (!cancelled) setIsAdmin(false);
    }
  };

  const updateAuth = (s: Session | null) => {
    if (cancelled) return;
    setSession(s);
    setUser(s?.user ?? null);
    if (!s?.user) setIsAdmin(false);
    initialResolved = true;
    setLoading(false);
    // Deferred so we never await a Supabase call while the auth lock is held.
    setTimeout(() => { void resolveRole(s); }, 0);
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
}

// ── Actions: plain async functions; state updates arrive via the
//    onAuthStateChange subscription above, so they need no React access. ──

export async function login(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error };
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password',
  });
  return { error };
}

export async function signUp(email: string, password: string, displayName?: string, captchaToken?: string) {
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
}
