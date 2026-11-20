import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import type { Notebook } from '../api/types';
import { changeRole, inviteMember, listMembers, removeMember, revokeInvite, type Role } from '../api/members';
import { formatDateTime } from '../lib/dates';
import { Modal } from './Modal';
import { ErrorMessage, Spinner } from './States';

const ROLE_LABELS: Record<Role, string> = { read: 'Can read', edit: 'Can edit' };

/**
 * Who a notebook is shared with, for its owner: the members with what they
 * may do, the open invitations, and a form to invite an address.
 */
export function MembersDialog({ notebookId, name, onClose }: { notebookId: string; name: string; onClose(): void }) {
  const queryClient = useQueryClient();
  const key = ['members', notebookId];
  const members = useQuery({ queryKey: key, queryFn: () => listMembers(notebookId) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('read');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
  };
  const invite = useMutation({
    mutationFn: () => inviteMember(notebookId, email.trim(), role),
    onSuccess: () => {
      setEmail('');
      refresh();
    },
  });
  const change = useMutation({
    mutationFn: ({ userId, next }: { userId: string; next: Role }) => changeRole(notebookId, userId, next),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (userId: string) => removeMember(notebookId, userId), onSuccess: refresh });
  const withdraw = useMutation({ mutationFn: (id: string) => revokeInvite(notebookId, id), onSuccess: refresh });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim()) invite.mutate();
  };

  return (
    <Modal title={`Share “${name}” with people`} onClose={onClose}>
      <p className="muted">
        Members see this notebook and the notebooks inside it in their own sidebar. Readers can read the notes. Editors
        can also change their text and tags and add notes, which stay yours. Your other notebooks, notes and tags stay
        yours alone.
      </p>
      <form className="form invite-form" onSubmit={submit}>
        <label className="field">
          <span>Invite by email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="read">{ROLE_LABELS.read}</option>
            <option value="edit">{ROLE_LABELS.edit}</option>
          </select>
        </label>
        <div className="form-actions start">
          <button type="submit" className="button button-primary" disabled={invite.isPending}>
            Invite
          </button>
        </div>
      </form>
      {[invite.error, change.error, remove.error, withdraw.error].map(
        (error, index) => error && <ErrorMessage key={index} error={error} />,
      )}
      {members.isLoading && <Spinner />}
      {members.error && <ErrorMessage error={members.error} />}
      {members.data && (
        <>
          <h3>Members</h3>
          {members.data.members.length === 0 ? (
            <p className="muted">Nobody yet.</p>
          ) : (
            <ul className="member-list">
              {members.data.members.map((member) => (
                <li key={member.userId}>
                  <span>
                    {member.name} <span className="muted">{member.email}</span>
                  </span>
                  <select
                    aria-label={`Role of ${member.name}`}
                    value={member.role}
                    onChange={(event) => change.mutate({ userId: member.userId, next: event.target.value as Role })}
                  >
                    <option value="read">{ROLE_LABELS.read}</option>
                    <option value="edit">{ROLE_LABELS.edit}</option>
                  </select>
                  <button type="button" className="link-button" onClick={() => remove.mutate(member.userId)}>
                    Remove {member.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {members.data.invites.length > 0 && (
            <>
              <h3>Invited</h3>
              <ul className="member-list">
                {members.data.invites.map((sent) => (
                  <li key={sent.id}>
                    <span>
                      {sent.email}{' '}
                      <span className="muted">
                        {ROLE_LABELS[sent.role]}, open until {formatDateTime(sent.expiresAt)}
                      </span>
                    </span>
                    <button type="button" className="link-button" onClick={() => withdraw.mutate(sent.id)}>
                      Withdraw the invitation to {sent.email}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/** Who has a notebook that is shared with you: its owner and the other members. */
export function MembersList({ notebook, onClose }: { notebook: Notebook; onClose(): void }) {
  const members = useQuery({ queryKey: ['members', notebook.id], queryFn: () => listMembers(notebook.id) });
  return (
    <Modal title={`Who has “${notebook.name}”`} onClose={onClose}>
      {members.isLoading && <Spinner />}
      {members.error && <ErrorMessage error={members.error} />}
      {members.data && (
        <ul className="member-list">
          <li>
            <span>{members.data.owner.name}</span> <span className="muted">owner</span>
          </li>
          {members.data.members.map((member) => (
            <li key={member.userId}>
              <span>{member.name}</span> <span className="muted">{ROLE_LABELS[member.role]}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
