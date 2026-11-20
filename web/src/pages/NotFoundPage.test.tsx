import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  it('says so and leads back to the notes', async () => {
    renderWithProviders(<NotFoundPage />, { route: '/nowhere' });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your notes' })).toHaveAttribute('href', '/notes');
    await expectNoAxeViolations();
  });
});
