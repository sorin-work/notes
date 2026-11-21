import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { confirmEmail, me } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, focusOnce } from '../components/States';

function tokenIn(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}

/**
 * Where the link mailed to a new address leads: /confirm-email#token=...
 * Opening the page changes nothing. The address is taken with the button,
 * so that a mail scanner that opens every link does not confirm it for the
 * owner. The token is in the fragment, as with a reset link, so it stays out
 * of the server's access log.
 */
export function ConfirmEmailPage() {
  const { user, updateUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => tokenIn(location.hash));

  useEffect(() => {
    if (location.hash) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  const confirm = useMutation({
    mutationFn: () => confirmEmail(token),
    onSuccess: async () => {
      // Signed in here: show the new address without a reload.
      if (user) updateUser(await me());
    },
  });

  if (confirm.isSuccess) {
    return (
      <main className="auth-page">
        <div className="auth-card form" role="status">
          <h1 tabIndex={-1} ref={focusOnce}>
            Email address changed
          </h1>
          <p>From now on you sign in with the new address.</p>
          <p>{user ? <Link to="/settings">Back to Settings</Link> : <Link to="/login">Sign in</Link>}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form
        className="auth-card form"
        onSubmit={(event) => {
          event.preventDefault();
          confirm.mutate();
        }}
      >
        <h1 tabIndex={-1} ref={focusOnce}>
          {token ? 'Confirm the new email address' : 'This link is not complete'}
        </h1>
        {token ? (
          <p>The account takes this address as its email once you confirm it here.</p>
        ) : (
          <p>Open the link from the mail again, or change the email in Settings once more.</p>
        )}
        {confirm.error && <ErrorMessage error={confirm.error} />}
        {token && (
          <button type="submit" className="button button-primary wide" disabled={confirm.isPending}>
            {confirm.isPending ? 'Confirming…' : 'Confirm the address'}
          </button>
        )}
      </form>
    </main>
  );
}
