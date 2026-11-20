import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { acceptInvite, declineInvite, receivedInvites } from '../api/members';

/** Invitations to notebooks of other accounts, to accept or turn down. Shown at the top of the sidebar. */
export function Invitations() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invites = useQuery({ queryKey: ['invites'], queryFn: receivedInvites });
  const accept = useMutation({
    mutationFn: acceptInvite,
    onSuccess: ({ notebookId }) => {
      void queryClient.invalidateQueries({ queryKey: ['invites'] });
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
      navigate(`/notes?notebook=${notebookId}`);
    },
  });
  const decline = useMutation({
    mutationFn: declineInvite,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  if (!invites.data || invites.data.length === 0) return null;
  return (
    <div className="invitations" role="status">
      {invites.data.map((invite) => (
        <div key={invite.id} className="invitation">
          <p>
            {invite.from.name} invited you to “{invite.notebook.name}”, to {invite.role === 'edit' ? 'edit' : 'read'}.
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={accept.isPending}
            onClick={() => accept.mutate(invite.id)}
          >
            Accept
          </button>{' '}
          <button
            type="button"
            className="button"
            disabled={decline.isPending}
            onClick={() => decline.mutate(invite.id)}
          >
            Decline
          </button>
        </div>
      ))}
    </div>
  );
}
