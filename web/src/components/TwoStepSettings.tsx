import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { disableTwoStep, enableTwoStep, newRecoveryCodes, startTwoStep, twoStepStatus } from '../api/auth';
import type { TwoStepSetup } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { QrCode } from './QrCode';
import { ErrorMessage } from './States';

/** The secret in groups of four, easier to type into an app by hand. */
function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** The recovery codes, shown once, with ways to keep them. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone(): void }) {
  const [copied, setCopied] = useState(false);
  const text = `Recovery codes for Notes. Each works once, in place of a code from the app.\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'notes-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="import-result" role="status">
      <p>
        <strong>Keep these recovery codes somewhere safe.</strong> Each one signs you in once without the phone. They
        are not shown again.
      </p>
      <ul className="recovery-codes" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="form-actions start">
        <button type="button" className="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="button" onClick={download}>
          Download
        </button>
        <button type="button" className="button button-primary" onClick={onDone}>
          I have kept them
        </button>
      </div>
    </div>
  );
}

/** Password and code, for turning codes off or making new recovery codes. */
function PasswordAndCode({
  title,
  action,
  danger,
  onSubmit,
}: {
  title: string;
  action: string;
  danger?: boolean;
  onSubmit(password: string, code: string): Promise<unknown>;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const run = useMutation({
    mutationFn: () => onSubmit(password, code.trim()),
    onSuccess: () => {
      setPassword('');
      setCode('');
    },
  });
  return (
    <form
      className="form narrow"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        run.mutate();
      }}
    >
      <h4>{title}</h4>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>Code from the app, or a recovery code</span>
        <input
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={40}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
      </label>
      {run.error && <ErrorMessage error={run.error} />}
      <div className="form-actions start">
        <button type="submit" className={danger ? 'button button-danger' : 'button'} disabled={run.isPending}>
          {action}
        </button>
      </div>
    </form>
  );
}

/**
 * Two-step sign-in in Settings: turning it on with a QR code and the first
 * code from the app, the recovery codes, and turning it off.
 */
export function TwoStepSettings() {
  const queryClient = useQueryClient();
  const { renewSession, updateUser, user } = useAuth();
  const status = useQuery({ queryKey: ['two-step'], queryFn: twoStepStatus });
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['two-step'] });

  const start = useMutation({
    mutationFn: () => startTwoStep(password),
    onSuccess: (next) => {
      setSetup(next);
      setPassword('');
    },
  });
  const enable = useMutation({
    mutationFn: () => enableTwoStep(code.trim()),
    onSuccess: (result) => {
      // Every other session ended, this one with them: the answer holds its new token.
      renewSession(result);
      setCodes(result.recoveryCodes);
      setSetup(null);
      setCode('');
      refresh();
    },
  });

  // Quietly: the rest of Settings works without it, and an alert here would crowd out the ones that matter.
  if (status.error) return <p className="muted">Two-step sign-in could not be loaded.</p>;
  if (!status.data) return null;

  return (
    <div className="form narrow two-step">
      <h3>Two-step sign-in</h3>
      {codes && (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            refresh();
          }}
        />
      )}
      {!status.data.available && !status.data.on && (
        <p className="muted">
          This server cannot ask for codes: it has no <code>TWO_STEP_KEY</code>. See the README.
        </p>
      )}

      {status.data.available && !status.data.on && !setup && (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            start.mutate();
          }}
        >
          <p className="muted">
            With two-step sign-in on, signing in takes a code from an authenticator app on your phone as well as the
            password, so a password that got out is not enough. Making a new API token asks for a code too.
          </p>
          <label className="field">
            <span>Password, to start</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {start.error && <ErrorMessage error={start.error} />}
          <div className="form-actions start">
            <button type="submit" className="button" disabled={start.isPending}>
              Set up two-step sign-in
            </button>
          </div>
        </form>
      )}

      {setup && (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            enable.mutate();
          }}
        >
          <p>Scan this with the authenticator app, or type the key into it by hand.</p>
          <QrCode text={setup.uri} label="QR code for the authenticator app" />
          <p>
            Key: <code className="two-step-secret">{grouped(setup.secret)}</code>
          </p>
          <label className="field">
            <span>The code the app shows now</span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={10}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
          {enable.error && <ErrorMessage error={enable.error} />}
          <div className="form-actions start">
            <button type="button" className="button" onClick={() => setSetup(null)}>
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={enable.isPending}>
              Turn on
            </button>
          </div>
        </form>
      )}

      {status.data.on && (
        <>
          <p>
            On. Signing in asks for a code from the app.{' '}
            {status.data.recoveryCodesLeft === 1
              ? '1 recovery code is left.'
              : `${status.data.recoveryCodesLeft} recovery codes are left.`}
          </p>
          {!status.data.available && (
            <p className="field-error">
              The server has lost its <code>TWO_STEP_KEY</code>, so codes from the app cannot be checked. Recovery codes
              still work.
            </p>
          )}
          <PasswordAndCode
            title="New recovery codes"
            action="Make new recovery codes"
            onSubmit={async (currentPassword, given) => {
              const result = await newRecoveryCodes(currentPassword, given);
              setCodes(result.recoveryCodes);
            }}
          />
          <PasswordAndCode
            title="Turn off"
            action="Turn off two-step sign-in"
            danger
            onSubmit={async (currentPassword, given) => {
              await disableTwoStep(currentPassword, given);
              if (user) updateUser({ ...user, twoStep: false });
              refresh();
            }}
          />
        </>
      )}
    </div>
  );
}
