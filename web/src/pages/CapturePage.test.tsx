import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { note } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { CapturePage } from './CapturePage';

function renderCapture(query: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/capture" element={<CapturePage />} />
      <Route path="/notes/:noteId" element={<div>The saved note</div>} />
      <Route path="/notes" element={<div>All notes</div>} />
    </Routes>,
    { route: `/capture${query}` },
  );
}

describe('CapturePage', () => {
  it('fills the note in from the address and saves nothing by itself', async () => {
    const calls = mockFetch({ 'POST /api/notes': { status: 201, body: note({ id: 'n9' }) } });
    renderCapture('?title=Bread%20basics&url=https%3A%2F%2Fexample.com%2Fbread');

    expect(screen.getByLabelText('Title')).toHaveValue('Bread basics');
    expect(screen.getByLabelText('Text')).toHaveValue('[Bread basics](<https://example.com/bread>)\n\n');
    expect(calls).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Text'), 'Try the overnight one.');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByText('The saved note')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/notes',
      body: { title: 'Bread basics', content: '[Bread basics](<https://example.com/bread>)\n\nTry the overnight one.' },
    });
  });

  it('opens empty without a title or an address, and can be left without saving', async () => {
    const calls = mockFetch({});
    renderCapture('');

    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Text')).toHaveValue('');
    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }));

    expect(await screen.findByText('All notes')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows why when the note could not be saved', async () => {
    mockFetch({ 'POST /api/notes': { status: 400, body: { message: 'title is too long', statusCode: 400 } } });
    renderCapture('?title=x');

    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('title is too long');
  });
});
