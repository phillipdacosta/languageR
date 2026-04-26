import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Alert } from 'react-native';
import { useAuth0, Auth0Provider } from 'react-native-auth0';
import i18n from 'i18next';
import { User } from '../types/user';
import { authService } from '../services/auth';
import { api } from '../services/api';
import { clearDetailCache } from '../services/lessons';
import { socketService } from '../services/socket';
import { env } from '../config/env';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function AuthProviderInner({ children }: { children: ReactNode }) {
  const { authorize, clearSession, getCredentials, user: auth0User } = useAuth0();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBackendUser = useCallback(async () => {
    try {
      const creds = await getCredentials();
      if (!creds?.idToken) {
        console.warn('[Auth] No idToken from getCredentials');
        return null;
      }

      // Decode both tokens to compare sub claims
      try {
        if (creds.idToken) {
          const idPayload = JSON.parse(atob(creds.idToken.split('.')[1]));
          console.log('[Auth] ID token sub:', idPayload.sub, 'email:', idPayload.email);
        }
        if (creds.accessToken) {
          const accPayload = JSON.parse(atob(creds.accessToken.split('.')[1]));
          console.log('[Auth] Access token sub:', accPayload.sub, 'email:', accPayload.email || 'none');
        }
      } catch {}
      const token = creds.idToken || creds.accessToken;
      console.log('[Auth] Using token type:', creds.idToken ? 'idToken' : 'accessToken');
      api.setToken(token);
      const backendUser = await authService.getMe(token);
      /**
       * Establish the realtime socket once we have an authenticated user.
       * The socket is idempotent — calling connect() again on token refresh
       * is safe. No-op during the brief window where the token is set but
       * the backend hasn't been reached yet (that's fine, first consumer
       * will reconnect).
       */
      try {
        socketService.connect();
      } catch (e) {
        console.warn('[Auth] socket connect failed:', e);
      }
      return backendUser;
    } catch (err: any) {
      console.warn('[Auth] fetchBackendUser failed:', err?.message || err);
      return null;
    }
  }, [getCredentials]);

  const syncLanguage = useCallback((u: User | null) => {
    if (u?.interfaceLanguage && i18n.language !== u.interfaceLanguage) {
      i18n.changeLanguage(u.interfaceLanguage);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const backendUser = await fetchBackendUser();
        setUser(backendUser);
        syncLanguage(backendUser);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchBackendUser, syncLanguage]);

  const login = useCallback(async () => {
    try {
      await authorize({
        audience: env.auth0.audience,
        scope: 'openid profile email offline_access',
      });

      const backendUser = await fetchBackendUser();
      if (!backendUser) {
        Alert.alert('Login Issue', `Authenticated but couldn't reach backend at ${env.apiUrl}. Is your backend running?`);
      }
      setUser(backendUser);
      syncLanguage(backendUser);
    } catch (err: any) {
      if (err?.message?.includes('cancelled') || err?.message?.includes('CANCELED')) return;
      throw err;
    }
  }, [authorize, fetchBackendUser, syncLanguage]);

  const logout = useCallback(async () => {
    try {
      await clearSession();
    } catch {
      // Auth0 clear can fail silently
    }
    api.clearToken();
    clearDetailCache();
    try {
      socketService.disconnect();
    } catch {
      // Best-effort — don't block logout on socket teardown.
    }
    setUser(null);
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const backendUser = await fetchBackendUser();
    setUser(backendUser);
    syncLanguage(backendUser);
  }, [fetchBackendUser, syncLanguage]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <Auth0Provider
      domain={env.auth0.domain}
      clientId={env.auth0.clientId}
    >
      <AuthProviderInner>{children}</AuthProviderInner>
    </Auth0Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
