import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { normalizePermissions } from '../utils/permissions';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [hasUsers, setHasUsers] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [error, setError] = useState(null);

  const hydrateUser = useCallback((nextUser) => {
    if (!nextUser) return null;
    return {
      ...nextUser,
      permissions: normalizePermissions(nextUser.permissions || {}),
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.authStatus();
      const nextHasUsers = !!status?.hasUsers;
      const nextNeedsBootstrap = !!status?.needsBootstrap;
      setHasUsers(nextHasUsers);
      setNeedsBootstrap(nextNeedsBootstrap);

      if (nextHasUsers) {
        try {
          const me = await api.authMe();
          setUser(hydrateUser(me?.user || null));
        } catch (err) {
          if (err?.status === 401) {
            setUser(null);
          } else {
            throw err;
          }
        }
      } else {
        setUser(null);
      }
      setError(null);
    } catch (err) {
      console.error('Auth refresh failed', err);
      setError(err?.message || 'Failed to check auth status');
    } finally {
      setLoading(false);
    }
  }, [hydrateUser]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
    }
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('glintex:auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('glintex:auth:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async ({ username, password }) => {
    const res = await api.authLogin(username, password);
    const nextUser = hydrateUser(res?.user || null);
    setUser(nextUser);
    setHasUsers(true);
    setNeedsBootstrap(false);
    setError(null);
    try {
      const me = await api.authMe();
      if (me?.user) setUser(hydrateUser(me.user));
    } catch (_) {
      // ignore; login response is good enough
    }
    return nextUser;
  }, [hydrateUser]);

  const bootstrap = useCallback(async ({ bootstrapToken, username, password, displayName }) => {
    const res = await api.authBootstrap({ bootstrapToken, username, password, displayName });
    const nextUser = hydrateUser(res?.user || null);
    setUser(nextUser);
    setHasUsers(true);
    setNeedsBootstrap(false);
    setError(null);
    try {
      const me = await api.authMe();
      if (me?.user) setUser(hydrateUser(me.user));
    } catch (_) {
      // ignore; bootstrap response is good enough
    }
    return nextUser;
  }, [hydrateUser]);

  const logout = useCallback(async () => {
    try {
      await api.authLogout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({
    loading,
    user,
    hasUsers,
    needsBootstrap,
    error,
    refresh,
    login,
    bootstrap,
    logout,
  }), [loading, user, hasUsers, needsBootstrap, error, refresh, login, bootstrap, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
