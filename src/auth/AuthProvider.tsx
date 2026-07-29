import type { User } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { allowDevelopmentAuth, getAuthRedirectUrl, isDesktopApp, supabase } from './supabase';
import { AuthContext, type AuthContextValue, type AuthSession } from './authContext';

const OFFLINE_SESSION_KEY = 'dongni-market-offline-session';
const OFFLINE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function fromUser(user: User): AuthSession {
  const now = Date.now();
  return {
    userId: user.id,
    email: user.email || '未命名账号',
    online: true,
    lastVerifiedAt: now,
    offlineUntil: isDesktopApp ? now + OFFLINE_WINDOW_MS : undefined,
  };
}

function persistOfflineSession(session: AuthSession | null) {
  if (!isDesktopApp) return;
  try {
    if (session?.offlineUntil) window.localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(OFFLINE_SESSION_KEY);
  } catch {
    // Authentication remains available online when local storage is unavailable.
  }
}

function readOfflineSession() {
  if (!isDesktopApp) return null;
  try {
    const value = window.localStorage.getItem(OFFLINE_SESSION_KEY);
    if (!value) return null;
    const stored = JSON.parse(value) as AuthSession;
    if (!stored.userId || !stored.email || !stored.offlineUntil || stored.offlineUntil <= Date.now()) return null;
    return { ...stored, online: false };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const developmentMode = allowDevelopmentAuth && !supabase;

  useEffect(() => {
    let active = true;
    if (developmentMode) {
      try {
        const stored = window.localStorage.getItem('dongni-market-dev-session');
        if (stored) setSession(JSON.parse(stored) as AuthSession);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!supabase) {
      setLoading(false);
      return;
    }
    const client = supabase;

    const verifyOnlineSession = async () => {
      if (!navigator.onLine) {
        if (active) {
          setSession(readOfflineSession());
          setLoading(false);
        }
        return;
      }
      const { data, error } = await client.auth.getUser();
      if (!active) return;
      if (!error && data.user) {
        const next = fromUser(data.user);
        setSession(next);
        persistOfflineSession(next);
      } else if (isDesktopApp) {
        setSession(readOfflineSession());
      } else {
        setSession(null);
      }
      setLoading(false);
    };
    void verifyOnlineSession();

    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        setSession(null);
        persistOfflineSession(null);
      } else if (event !== 'INITIAL_SESSION' && nextSession?.user) {
        const next = fromUser(nextSession.user);
        setSession(next);
        persistOfflineSession(next);
      }
      if (event !== 'INITIAL_SESSION') setLoading(false);
    });

    const handleOffline = () => {
      if (isDesktopApp) setSession((current) => current ? { ...current, online: false } : readOfflineSession());
    };
    const handleOnline = () => {
      void client.auth.getUser().then(({ data: authData }) => {
        if (authData.user) {
          const next = fromUser(authData.user);
          setSession(next);
          persistOfflineSession(next);
        }
      });
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      active = false;
      data.subscription.unsubscribe();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [developmentMode]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (developmentMode) {
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 6) throw new Error('请输入有效邮箱和至少6位密码');
      const now = Date.now();
      const next: AuthSession = { userId: `dev-${email.toLowerCase()}`, email, online: true, lastVerifiedAt: now, offlineUntil: now + OFFLINE_WINDOW_MS };
      window.localStorage.setItem('dongni-market-dev-session', JSON.stringify(next));
      setSession(next);
      return;
    }
    if (!supabase) throw new Error('登录服务尚未配置');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('请先打开邮箱完成验证');
    }
  }, [developmentMode]);

  const signUp = useCallback(async (email: string, password: string) => {
    if (developmentMode) {
      await signIn(email, password);
      return;
    }
    if (!supabase) throw new Error('注册服务尚未配置');
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getAuthRedirectUrl('/login') },
    });
    if (error) throw error;
  }, [developmentMode, signIn]);

  const signOut = useCallback(async () => {
    if (developmentMode) {
      window.localStorage.removeItem('dongni-market-dev-session');
    } else if (supabase) {
      await supabase.auth.signOut();
    }
    persistOfflineSession(null);
    setSession(null);
  }, [developmentMode]);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (developmentMode) return;
    if (!supabase) throw new Error('找回密码服务尚未配置');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: getAuthRedirectUrl('/reset') });
    if (error) throw error;
  }, [developmentMode]);

  const updatePassword = useCallback(async (password: string) => {
    if (developmentMode) return;
    if (!supabase) throw new Error('重置密码服务尚未配置');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, [developmentMode]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    configured: Boolean(supabase) || developmentMode,
    developmentMode,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
  }), [developmentMode, loading, sendPasswordReset, session, signIn, signOut, signUp, updatePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
