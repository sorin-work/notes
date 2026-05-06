import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage } from '../components/States';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(name, email, password);
      navigate('/notes', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const messages = error instanceof ApiError && error.messages.length > 1 ? error.messages : null;

  return (
    <div className="auth-page">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Create your account</h1>
        <label className="field">
          <span>Name</span>
          <input
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            aria-describedby="password-hint"
          />
        </label>
        <small id="password-hint" className="muted">
          At least 8 characters.
        </small>
        {messages ? (
          <ul className="error-box" role="alert">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : (
          error !== null && <ErrorMessage error={error} />
        )}
        <button type="submit" className="button button-primary wide" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
