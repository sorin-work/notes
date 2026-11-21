import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from '../components/MarkdownPreview';

// The chunk cannot be fetched, as without a connection.
vi.mock('../lib/richMarkdown', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

describe('useRichMarkdown when the plugins cannot load', () => {
  it('shows the note as plain text and says a reload shows the formulas', async () => {
    render(<MarkdownPreview content={'Area $$\\pi r^2$$'} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Reload the page to show them.');
    expect(screen.getByText(/Area \$\$\\pi r\^2\$\$/)).toBeInTheDocument();
  });
});
