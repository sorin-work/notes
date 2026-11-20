import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { note } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { VersionHistoryDialog } from './VersionHistoryDialog';

const current = { title: 'Plan', content: '# Newer draft' };

describe('VersionHistoryDialog', () => {
  it('previews a version and restores it', async () => {
    const versions = [
      { id: 'v2', title: 'Plan', characters: 20, createdAt: '2026-01-02T10:00:00Z' },
      { id: 'v1', title: 'Plan', characters: 5, createdAt: '2026-01-01T10:00:00Z' },
    ];
    const calls = mockFetch({
      'GET /api/notes/n1/versions': { body: versions },
      'GET /api/notes/n1/versions/v2': { body: { ...versions[0], content: '# Newer draft\n\n- [x] Outline' } },
      'GET /api/notes/n1/versions/v1': { body: { ...versions[1], content: '# First draft' } },
      'POST /api/notes/n1/versions/v1/restore': { body: note({ content: '# First draft' }) },
    });
    const onRestored = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <VersionHistoryDialog noteId="n1" current={current} onClose={onClose} onRestored={onRestored} />,
    );

    expect(await screen.findByRole('heading', { name: 'Newer draft' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /5 characters/ }));
    expect(await screen.findByRole('heading', { name: 'First draft' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ content: '# First draft' })));
    expect(onClose).toHaveBeenCalled();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/notes/n1/versions/v1/restore' });
  });

  it('shows what changed between a version and the text in the editor', async () => {
    const version = { id: 'v1', title: 'Plan', characters: 30, createdAt: '2026-01-01T10:00:00Z' };
    mockFetch({
      'GET /api/notes/n1/versions': { body: [version] },
      'GET /api/notes/n1/versions/v1': { body: { ...version, content: '# Plan\n\nShip in March' } },
    });
    renderWithProviders(
      <VersionHistoryDialog
        noteId="n1"
        current={{ title: 'Plan for spring', content: '# Plan\n\nShip in April' }}
        onClose={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const changes = await screen.findByRole('button', { name: 'Changes' });
    expect(changes).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Ship in March').tagName).toBe('P');

    await userEvent.click(changes);
    expect(changes).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Ship in March').closest('.diff-line')).toHaveClass('diff-removed');
    expect(screen.getByText('Ship in April').closest('.diff-line')).toHaveClass('diff-added');
    expect(screen.getByText(/The title changed/)).toHaveTextContent('from “Plan” to “Plan for spring”');

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.queryByText('Ship in April')).not.toBeInTheDocument();
  });

  it('explains when there are no versions yet', async () => {
    mockFetch({ 'GET /api/notes/n1/versions': { body: [] } });
    renderWithProviders(<VersionHistoryDialog noteId="n1" current={current} onClose={vi.fn()} onRestored={vi.fn()} />);
    expect(await screen.findByText(/No earlier versions yet/)).toBeInTheDocument();
  });

  it('passes the axe checks in the preview and in the changes', async () => {
    const version = { id: 'v1', title: 'Plan', characters: 30, createdAt: '2026-01-01T10:00:00Z' };
    mockFetch({
      'GET /api/notes/n1/versions': { body: [version] },
      'GET /api/notes/n1/versions/v1': { body: { ...version, content: '## Plan\n\n- [x] Outline\n\nShip in March' } },
    });
    renderWithProviders(
      <VersionHistoryDialog
        noteId="n1"
        current={{ title: 'Plan for spring', content: '## Plan\n\nShip in April' }}
        onClose={vi.fn()}
        onRestored={vi.fn()}
      />,
    );
    expect(await screen.findByRole('checkbox', { name: 'Outline' })).toBeDisabled();
    await expectNoAxeViolations({ part: true });

    await userEvent.click(screen.getByRole('button', { name: 'Changes' }));
    await expectNoAxeViolations({ part: true });
  });
});
