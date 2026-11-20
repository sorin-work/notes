import { useMutation } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { requestPasswordReset } from '../api/auth';
import { ErrorMessage, focusOnce } from '../components/States';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => requestPasswordReset(email) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  if (send.isSuccess) {
    return (
      <main className="auth-page">
        <div className="auth-card form" role="status">
          <h1 tabIndex={-1} ref={focusOnce}>
            Check your mail
          </h1>
          <p>
            If {email.trim()} has an account here, a mail with a link to choose a new password is on its way. The link
            works once, for an hour.
          </p>
          <p className="muted">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Forgot your password?</h1>
        <p className="muted">Enter the email of your account. A link to choose a new password is mailed to it.</p>
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
        {send.error && <ErrorMessage error={send.error} />}
        <button type="submit" className="button button-primary wide" disabled={send.isPending}>
          {send.isPending ? 'Sending…' : 'Send the link'}
        </button>
        <p className="muted">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </main>
  );
}
