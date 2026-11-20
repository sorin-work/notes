import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { acceptInviteByToken } from '../api/members';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, Spinner } from '../components/States';

const KEY = 'notes.inviteToken';

/** The token arrives in the fragment of the mailed link and is kept in the tab while the user signs in. */
function takeToken(): string | null {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('token');
  try {
    if (fromLink) {
      sessionStorage.setItem(KEY, fromLink);
      window.history.replaceState(null, '', window.location.pathname);
    }
    return fromLink ?? sessionStorage.getItem(KEY);
  } catch {
    return fromLink;
  }
}

/**
 * Where the link in an invitation mail leads. Signed in with the invited
 * address, the invitation is accepted at once and the notebook opens.
 * Otherwise the page asks to sign in or to create an account with it.
 */
export function InvitePage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(takeToken);
  const accept = useMutation({
    mutationFn: acceptInviteByToken,
    onSuccess: ({ notebookId }) => {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        // Nothing to clean up then.
      }
      navigate(`/notes?notebook=${notebookId}`, { replace: true });
    },
  });
  const { mutate, isIdle } = accept;
  useEffect(() => {
    if (status === 'signed-in' && token && isIdle) mutate(token);
  }, [status, token, isIdle, mutate]);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Invitation to a notebook</h1>
        {!token && <p>This link has no invitation in it. Open the link from the mail again.</p>}
        {token && status === 'signed-out' && (
          <p>
            Sign in with the address the invitation was sent to, or create an account with it, to accept.{' '}
            <Link to="/login" state={{ from: '/invites' }}>
              Sign in
            </Link>{' '}
            or <Link to="/register">create an account</Link>.
          </p>
        )}
        {token && (status === 'loading' || accept.isPending) && <Spinner />}
        {accept.error && <ErrorMessage error={accept.error} />}
      </div>
    </main>
  );
}
