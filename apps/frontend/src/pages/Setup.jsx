import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '../components/ui';
import { useAuth } from '../context/AuthContext';

export function Setup() {
  const { loading, user, needsBootstrap, error: authError, bootstrap } = useAuth();
  const navigate = useNavigate();

  const [bootstrapToken, setBootstrapToken] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!needsBootstrap && !user) navigate('/login', { replace: true });
  }, [loading, needsBootstrap, user, navigate]);

  if (!loading && user) {
    return <Navigate to="/app/inbound" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await bootstrap({ bootstrapToken, username, password, displayName: displayName || null });
      navigate('/app/inbound', { replace: true });
    } catch (err) {
      setError(err?.message || 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>First-time setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {authError && <div className="text-sm text-destructive">{authError}</div>}
          {error && <div className="text-sm text-destructive">{error}</div>}
          <div className="text-sm text-muted-foreground">
            Enter the bootstrap token printed in the backend logs, then create the first admin user.
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Bootstrap Token</Label>
              <Input value={bootstrapToken} onChange={(e) => setBootstrapToken(e.target.value)} placeholder="Copy from backend logs" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </div>
              <div className="space-y-2">
                <Label>Display Name (optional)</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <div className="text-xs text-muted-foreground">Minimum 6 characters.</div>
            </div>
            <Button type="submit" className="w-full" disabled={submitting || loading || !bootstrapToken || !username || !password}>
              {submitting ? 'Creating admin…' : 'Create admin user'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

