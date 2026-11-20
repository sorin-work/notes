import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { passwordResetEnabled } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage } from '../components/States';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Only servers that can send mail offer a reset. Until the answer is in,
  // and if it never comes, the link stays hidden.
  const canReset = useQuery({ queryKey: ['password-reset-enabled'], queryFn: passwordResetEnabled, retry: false });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/notes', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Sign in to Notes</h1>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error !== null && <ErrorMessage error={error} />}
        <button type="submit" className="button button-primary wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted">
          New here? <Link to="/register">Create an account</Link>
        </p>
        {canReset.data === true && (
          <p className="muted">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
        )}
      </form>
    </main>
  );
}
