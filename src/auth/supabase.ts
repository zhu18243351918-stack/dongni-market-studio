import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'dongni-market-auth',
      },
    })
  : null;

export const isDesktopApp = import.meta.env.VITE_APP_TARGET === 'desktop' || '__TAURI_INTERNALS__' in window;
export const allowDevelopmentAuth = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_AUTH === 'true';

export function getAuthRedirectUrl(path = '/login') {
  const configured = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim();
  if (configured) return `${configured.replace(/\/$/, '')}/#${path}`;
  return `${window.location.origin}${window.location.pathname}#${path}`;
}
