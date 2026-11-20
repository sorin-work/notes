import { ConfigError, loadConfig, logLevelsFrom } from './config';

const base = {
  DATABASE_URL: 'postgresql://notes:notes@localhost:5441/notes',
  JWT_SECRET: 'a'.repeat(32),
};

describe('loadConfig', () => {
  it('uses defaults for optional settings', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      port: 4401,
      jwtExpiresIn: '7d',
      corsOrigins: [],
      seedDemo: false,
      trashRetentionDays: 30,
      authThrottleLimit: 10,
      mail: null,
      appUrl: 'http://localhost:5181',
    });
    expect(config.logLevels).toEqual(['error', 'warn', 'log']);
  });

  it('reads every setting from the environment', () => {
    const config = loadConfig({
      ...base,
      PORT: '8080',
      CORS_ORIGINS: 'http://localhost:5181, https://notes.example.com',
      SEED_DEMO: 'true',
      TRASH_RETENTION_DAYS: '7',
      LOG_LEVEL: 'debug',
    });
    expect(config.port).toBe(8080);
    expect(config.corsOrigins).toEqual(['http://localhost:5181', 'https://notes.example.com']);
    expect(config.seedDemo).toBe(true);
    expect(config.trashRetentionDays).toBe(7);
    expect(config.logLevels).toContain('debug');
  });

  it('reads the SMTP settings when a host is given', () => {
    const config = loadConfig({
      ...base,
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'Notes <notes@example.com>',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'secret',
      APP_URL: 'https://notes.example.com/',
    });
    expect(config.mail).toEqual({
      host: 'smtp.example.com',
      port: 587,
      from: 'Notes <notes@example.com>',
      user: 'mailer',
      password: 'secret',
      requireTls: true,
    });
    expect(config.appUrl).toBe('https://notes.example.com');
    const mailpit = { ...base, SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_FROM: 'a@b.c', APP_URL: 'http://x.test' };
    expect(loadConfig({ ...mailpit, SMTP_REQUIRE_TLS: 'false' }).mail).toEqual({
      host: 'mailpit',
      port: 1025,
      from: 'a@b.c',
      user: undefined,
      password: undefined,
      requireTls: false,
    });
  });

  it('requires TLS for mail unless SMTP_REQUIRE_TLS plainly says no', () => {
    const mail = { ...base, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'a@b.c', APP_URL: 'http://x.test' };
    for (const value of [undefined, '', 'true', 'yes', 'fasle', 'smtp.example.com']) {
      expect(loadConfig({ ...mail, SMTP_REQUIRE_TLS: value }).mail?.requireTls).toBe(true);
    }
    for (const value of ['false', 'FALSE', '0', 'no', ' off ']) {
      expect(loadConfig({ ...mail, SMTP_REQUIRE_TLS: value }).mail?.requireTls).toBe(false);
    }
  });

  it('turns mail off without SMTP_HOST, and wants a sender and the app address with it', () => {
    expect(loadConfig({ ...base, SMTP_FROM: 'a@b.c', SMTP_PORT: '25' }).mail).toBeNull();
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', APP_URL: 'http://x.test' })).toThrow(
      'SMTP_FROM is required',
    );
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'a@b.c' })).toThrow(
      'APP_URL is required when SMTP_HOST is set',
    );
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({ JWT_SECRET: base.JWT_SECRET })).toThrow(ConfigError);
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow('JWT_SECRET must be at least 32 characters');
  });

  it('rejects numbers that are not integers', () => {
    expect(() => loadConfig({ ...base, TRASH_RETENTION_DAYS: 'soon' })).toThrow('TRASH_RETENTION_DAYS');
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow('PORT');
  });
});

describe('logLevelsFrom', () => {
  it('treats info as Nest log level "log"', () => {
    expect(logLevelsFrom('info')).toEqual(['error', 'warn', 'log']);
  });

  it('includes everything up to the chosen level', () => {
    expect(logLevelsFrom('error')).toEqual(['error']);
    expect(logLevelsFrom('WARN')).toEqual(['error', 'warn']);
  });

  it('rejects unknown levels', () => {
    expect(() => logLevelsFrom('loud')).toThrow(ConfigError);
  });
});
