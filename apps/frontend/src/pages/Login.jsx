import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '../components/ui';
import { useAuth } from '../context/AuthContext';

export function Login() {
  const { loading, user, needsBootstrap, error: authError, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = useMemo(() => location.state?.from?.pathname || '/app/inbound', [location.state]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (needsBootstrap) navigate('/setup', { replace: true });
  }, [loading, needsBootstrap, navigate]);

  // Fetch and apply public branding (favicon) on login page
  useEffect(() => {
    async function loadPublicBranding() {
      try {
        const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:4001';
        const res = await fetch(`${apiBase}/api/public/branding`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.faviconDataUrl) {
          let link = document.querySelector("link[rel*='icon']") || document.createElement('link');
          link.type = 'image/x-icon';
          link.rel = 'shortcut icon';
          link.href = data.faviconDataUrl;
          document.head.appendChild(link);
        }
      } catch (err) {
        console.warn('Failed to load public branding', err);
      }
    }
    loadPublicBranding();
  }, []);

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ username, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-background">
      <Card className="w-full max-w-[400px] shadow-lg">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {authError && <div className="text-sm text-destructive">{authError}</div>}
          {error && <div className="text-sm text-destructive">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || loading || !username || !password}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

