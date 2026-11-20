import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listApiTokens, revokeAllApiTokens } from '../api/tokens';
import { formatRelative } from '../lib/dates';
import { ErrorMessage } from './States';

/**
 * For right after the password was changed or reset. That ends every login
 * but leaves the API tokens alone, on purpose: a script that stops working
 * without a word is worse than one that goes on. So the tokens are shown,
 * with one button to end them all. Shows nothing when there are none.
 */
export function ApiTokensStillWorking() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: listApiTokens });
  const revoke = useMutation({
    mutationFn: revokeAllApiTokens,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  if (revoke.isSuccess) {
    return (
      <p className="success" role="status">
        All API tokens are revoked. Scripts need a new one from Settings.
      </p>
    );
  }
  if (!tokens.data || tokens.data.length === 0) return null;

  return (
    <div className="tokens-still-working" role="group" aria-label="API tokens that still work">
      <p>The new password does not touch your API tokens. These still work:</p>
      <ul>
        {tokens.data.map((token) => (
          <li key={token.id}>
            {token.name}{' '}
            <span className="muted">
              {token.readOnly && '· read-only '}·{' '}
              {token.lastUsedAt ? `last used ${formatRelative(token.lastUsedAt)}` : 'never used'}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">If someone else may have known the old password, revoke them and make new ones.</p>
      {revoke.error && <ErrorMessage error={revoke.error} />}
      <div className="form-actions start">
        <button
          type="button"
          className="button button-danger-quiet"
          onClick={() => revoke.mutate()}
          disabled={revoke.isPending}
        >
          Revoke all tokens
        </button>
      </div>
    </div>
  );
}
