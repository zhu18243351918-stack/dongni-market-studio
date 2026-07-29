import { createContext, useContext } from 'react';

export interface AuthSession {
  userId: string;
  email: string;
  online: boolean;
  offlineUntil?: number;
  lastVerifiedAt: number;
}

export interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  configured: boolean;
  developmentMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
