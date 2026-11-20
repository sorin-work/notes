import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listApiTokens, revokeAllApiTokens } from '../api/tokens';
import { ErrorMessage } from './States';

/**
 * Goes with "Password changed" in Settings. A password change ends every
 * other login but keeps the API tokens, so that scripts do not stop without
 * a word. Whoever knew the old password could have made one of them,
 * though, so the line says how many still work and offers to end them all.
 */
export function ApiTokensStillWorking() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: listApiTokens });
  const revoke = useMutation({
    mutationFn: revokeAllApiTokens,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  if (revoke.isSuccess) {
    return <p className="success">All API tokens are revoked. Scripts need a new one.</p>;
  }
  if (tokens.error) return <ErrorMessage error={tokens.error} />;
  if (!tokens.data) return null;
  if (tokens.data.length === 0) return <p className="muted">The account has no API tokens.</p>;

  const count = tokens.data.length;
  return (
    <>
      <p className="tokens-still-working">
        {count === 1 ? '1 API token still works.' : `${count} API tokens still work.`}{' '}
        <button
          type="button"
          className="link-button danger"
          onClick={() => revoke.mutate()}
          disabled={revoke.isPending}
        >
          Revoke all
        </button>
      </p>
      {revoke.error && <ErrorMessage error={revoke.error} />}
    </>
  );
}
