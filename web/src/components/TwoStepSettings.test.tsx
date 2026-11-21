import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getToken, setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { expectNoAxeViolations } from '../test/axe';
import { user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { TwoStepSettings } from './TwoStepSettings';

const codes = Array.from({ length: 10 }, (_, at) => `aaaa-bbbb-cccc-${String(at).padStart(4, '2')}`);

function renderIt() {
  setToken('tok');
  return renderWithProviders(
    <AuthProvider>
      <main>
        <TwoStepSettings />
      </main>
    </AuthProvider>,
  );
}

describe('TwoStepSettings', () => {
  it('sets up codes with a QR code and the first code, then shows the recovery codes once', async () => {
    let on = false;
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/auth/two-step': () => ({ body: { available: true, on, recoveryCodesLeft: on ? 10 : 0 } }),
      'POST /api/auth/two-step/setup': {
        body: {
          secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/Notes:demo%40example.com?secret=JBSW',
        },
      },
      'POST /api/auth/two-step/enable': () => {
        on = true;
        return { body: { token: 'tok-2', user: { ...user, twoStep: true }, recoveryCodes: codes } };
      },
    });
    renderIt();

    await userEvent.type(await screen.findByLabelText('Password, to start'), 'demo-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }));
    expect(await screen.findByRole('img', { name: 'QR code for the authenticator app' })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await expectNoAxeViolations({ part: true });

    await userEvent.type(screen.getByLabelText('The code the app shows now'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    // The other sessions ended, and this one goes on with the new token.
    expect(getToken()).toBe('tok-2');
    expect(calls.find((call) => call.url === '/api/auth/two-step/setup')?.body).toEqual({
      currentPassword: 'demo-password',
    });

    await userEvent.click(screen.getByRole('button', { name: 'I have kept them' }));
    expect(screen.queryByRole('list', { name: 'Recovery codes' })).not.toBeInTheDocument();
    expect(await screen.findByText(/10 recovery codes are left/)).toBeInTheDocument();
  });

  it('turns codes off with the password and a code', async () => {
    let on = true;
    const calls = mockFetch({
      'GET /api/auth/me': { body: { ...user, twoStep: true } },
      'GET /api/auth/two-step': () => ({ body: { available: true, on, recoveryCodesLeft: 3 } }),
      'POST /api/auth/two-step/disable': () => {
        on = false;
        return { status: 204 };
      },
    });
    renderIt();

    expect(await screen.findByText(/3 recovery codes are left/)).toBeInTheDocument();
    const form = screen.getByRole('heading', { name: 'Turn off' }).closest('form')!;
    await userEvent.type(within(form).getByLabelText('Password'), 'demo-password');
    await userEvent.type(within(form).getByLabelText('Code from the app, or a recovery code'), ' 654321 ');
    await userEvent.click(within(form).getByRole('button', { name: 'Turn off two-step sign-in' }));
    expect(await screen.findByRole('button', { name: 'Set up two-step sign-in' })).toBeInTheDocument();
    expect(calls.find((call) => call.url === '/api/auth/two-step/disable')?.body).toEqual({
      currentPassword: 'demo-password',
      code: '654321',
    });
  });

  it('says so when the server cannot do codes', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/auth/two-step': { body: { available: false, on: false, recoveryCodesLeft: 0 } },
    });
    renderIt();
    expect(await screen.findByText(/This server cannot ask for codes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up two-step sign-in' })).not.toBeInTheDocument();
  });
});
