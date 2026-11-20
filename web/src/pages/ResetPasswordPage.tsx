import { useMutation } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { resetPassword } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage } from '../components/States';

function tokenIn(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}

/**
 * Where the link in a password reset mail leads: /reset-password#token=...
 * The token is in the fragment because a fragment is never sent to the
 * server, so it does not end up in nginx's access log the way a query
 * string does.
 */
export function ResetPasswordPage() {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Read once and kept in memory. The effect below takes it out of the address bar.
  const [token] = useState(() => tokenIn(location.hash));

  useEffect(() => {
    if (location.hash) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const reset = useMutation({
    mutationFn: () => resetPassword(token, password),
    // The reset ended every session, so one in this browser is over too.
    onSuccess: logout,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMismatch(password !== repeat);
    if (password === repeat) reset.mutate();
  };

  if (reset.isSuccess) {
    return (
      <div className="auth-page">
        <div className="auth-card form" role="status">
          <h1>Password changed</h1>
          <p>Every browser and device has been signed out. Sign in with the new password.</p>
          <p>
            <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card form">
          <h1>This link is not complete</h1>
          <p>Open the link from the mail again, or ask for a new one.</p>
          <p>
            <Link to="/forgot-password">Ask for a new link</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Choose a new password</h1>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
            aria-describedby="new-password-hint"
          />
        </label>
        <small id="new-password-hint" className="muted">
          At least 8 characters.
        </small>
        <label className="field">
          <span>Repeat new password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            required
          />
        </label>
        {mismatch && <p className="field-error">The new passwords do not match.</p>}
        {reset.error && <ErrorMessage error={reset.error} />}
        <button type="submit" className="button button-primary wide" disabled={reset.isPending}>
          {reset.isPending ? 'Saving…' : 'Set the new password'}
        </button>
        <p className="muted">
          <Link to="/forgot-password">Ask for a new link</Link>
        </p>
      </form>
    </div>
  );
}
