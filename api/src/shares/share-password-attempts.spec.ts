import type { AppConfig } from '../config/config';
import { SharePasswordAttempts, TooManyWrongPasswords } from './share-password-attempts';

describe('SharePasswordAttempts', () => {
  const start = Date.parse('2026-03-01T12:00:00Z');
  let attempts: SharePasswordAttempts;

  beforeEach(() => {
    attempts = new SharePasswordAttempts({ authThrottleLimit: 2 } as AppConfig);
  });

  it('hands out the allowance and then says how long to wait', () => {
    expect(attempts.take('link', start)).toBe(0);
    expect(attempts.take('link', start + 10_000)).toBe(0);
    expect(attempts.take('link', start + 20_000)).toBe(40);
    expect(attempts.take('link', start + 59_999)).toBe(1);
  });

  it('opens again a minute after the first attempt, however many were refused since', () => {
    attempts.take('link', start);
    attempts.take('link', start + 1000);
    for (let second = 2; second < 60; second++) {
      expect(attempts.take('link', start + second * 1000)).toBeGreaterThan(0);
    }
    expect(attempts.take('link', start + 60_000)).toBe(0);
  });

  it('takes an attempt back when the password was right', () => {
    attempts.take('link', start);
    attempts.take('link', start);
    attempts.giveBack('link');
    expect(attempts.take('link', start)).toBe(0);
    expect(attempts.take('link', start)).toBeGreaterThan(0);
    // Nothing to give back is not a credit.
    attempts.giveBack('other');
    attempts.giveBack('other');
    expect(attempts.take('other', start)).toBe(0);
    expect(attempts.take('other', start)).toBe(0);
    expect(attempts.take('other', start)).toBeGreaterThan(0);
  });

  it('keeps links apart', () => {
    attempts.take('one', start);
    attempts.take('one', start);
    expect(attempts.take('one', start)).toBeGreaterThan(0);
    expect(attempts.take('two', start)).toBe(0);
  });

  it('forgets links whose minute is over once there are many', () => {
    for (let i = 0; i < 1000; i++) attempts.take(`old-${i}`, start);
    attempts.take('new', start + 60_000);
    const windows = (attempts as unknown as { windows: Map<string, unknown> }).windows;
    expect([...windows.keys()]).toEqual(['new']);
  });

  it('answers 429 with a plain message', () => {
    const refused = new TooManyWrongPasswords(30);
    expect(refused.getStatus()).toBe(429);
    expect(refused.getResponse()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
  });
});
