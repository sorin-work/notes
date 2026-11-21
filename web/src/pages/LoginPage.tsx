import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { passwordResetEnabled } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useDiscardOthersQuestion } from '../components/DiscardOthersQuestion';
import { ErrorMessage, focusOnce } from '../components/States';

export function LoginPage() {
  const { login, loginWithCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Set once the password was right and the account asks for a code.
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, discardQuestion] = useDiscardOthersQuestion();
  // Only servers that can send mail offer a reset. Until the answer is in,
  // and if it never comes, the link stays hidden.
  const canReset = useQuery({ queryKey: ['password-reset-enabled'], queryFn: passwordResetEnabled, retry: false });

  const done = () => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== '/login' ? from : '/notes', { replace: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password, confirmDiscard);
      if (typeof result === 'object') {
        setTicket(result.ticket);
        setPassword('');
        setBusy(false);
        return;
      }
      if (!result) {
        setBusy(false);
        return;
      }
      done();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      if (await loginWithCode(ticket, code.trim(), confirmDiscard)) {
        done();
        return;
      }
    } catch (err) {
      setError(err);
      // A ticket that is used up or too old: back to the password.
      if (err instanceof ApiError && (err.status === 401 || err.status === 429)) setTicket(null);
    }
    setCode('');
    setBusy(false);
  };

  if (ticket) {
    return (
      <main className="auth-page">
        <form className="auth-card form" onSubmit={submitCode}>
          <h1>Enter your code</h1>
          <p className="muted">Open the authenticator app and type the six digits it shows for Notes.</p>
          <label className="field">
            <span>Code</span>
            <input
              autoComplete="one-time-code"
              inputMode="text"
              spellCheck={false}
              maxLength={40}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-describedby="code-hint"
              required
              // The form takes the place of the password form, where the focus was.
              ref={focusOnce}
            />
          </label>
          <p className="muted" id="code-hint">
            Without the phone, a recovery code works too, once each.
          </p>
          {error !== null && <ErrorMessage error={error} />}
          <button type="submit" className="button button-primary wide" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <p className="muted">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setTicket(null);
                setCode('');
                setError(null);
              }}
            >
              Back to the password
            </button>
          </p>
        </form>
        {discardQuestion}
      </main>
    );
  }

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
      {discardQuestion}
    </main>
  );
}
