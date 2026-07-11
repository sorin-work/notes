import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/render';
import { SharedNotePage } from './SharedNotePage';

function renderShared() {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:token" element={<SharedNotePage />} />
    </Routes>,
    { route: '/s/tok123' },
  );
}

describe('SharedNotePage', () => {
  it('renders the shared note without links to private notes', async () => {
    const calls = mockFetch({
      'GET /api/public/notes/tok123': {
        body: {
          title: 'Sourdough bread',
          content: '## Method\n\nFeed the [[Starter feeding schedule]]',
          tags: ['baking'],
          updatedAt: '2026-01-02T10:00:00Z',
        },
      },
    });
    renderShared();

    expect(await screen.findByRole('heading', { name: 'Sourdough bread' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Method' })).toBeInTheDocument();
    expect(screen.getByText('Starter feeding schedule').tagName).toBe('SPAN');
    expect(screen.getByText(/#baking/)).toBeInTheDocument();
    expect(calls[0]?.url).toBe('/api/public/notes/tok123');
  });

  it('explains when the link no longer works', async () => {
    mockFetch({});
    renderShared();
    expect(await screen.findByRole('heading', { name: 'This note is not shared' })).toBeInTheDocument();
  });
});
