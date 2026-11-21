import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { expectNoAxeViolations } from '../test/axe';
import { mockFetch, renderWithProviders } from '../test/render';
import { ConfirmEmailPage } from './ConfirmEmailPage';

function AddressBar() {
  const location = useLocation();
  return <span aria-label="address">{location.pathname + location.hash}</span>;
}

function renderAt(route: string) {
  return renderWithProviders(
    <AuthProvider>
      <AddressBar />
      <Routes>
        <Route path="/confirm-email" element={<ConfirmEmailPage />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('ConfirmEmailPage', () => {
  it('takes the token out of the address bar and confirms only when asked', async () => {
    const calls = mockFetch({ 'POST /api/auth/email/confirm': { status: 204 } });
    renderAt('/confirm-email#token=from-the-mail');

    expect(await screen.findByLabelText('address')).toHaveTextContent(/^\/confirm-email$/);
    // Opening the page sends nothing, so a scanner that follows links does not confirm.
    expect(calls).toEqual([]);
    await expectNoAxeViolations();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm the address' }));
    expect(await screen.findByRole('heading', { name: 'Email address changed' })).toBeInTheDocument();
    expect(calls).toEqual([
      expect.objectContaining({ method: 'POST', url: '/api/auth/email/confirm', body: { token: 'from-the-mail' } }),
    ]);
  });

  it('says why a link that is used up does not work', async () => {
    mockFetch({
      'POST /api/auth/email/confirm': {
        status: 400,
        body: { statusCode: 400, message: 'This link does not work any more. Change the email in Settings again.' },
      },
    });
    renderAt('/confirm-email#token=old');
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm the address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not work any more');
  });

  it('says a link without its token is not complete', async () => {
    mockFetch({});
    renderAt('/confirm-email');
    expect(await screen.findByRole('heading', { name: 'This link is not complete' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
