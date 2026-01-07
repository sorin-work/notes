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
      trashRetentionDays: 30,
    });
    expect(config.logLevels).toEqual(['error', 'warn', 'log']);
  });

  it('reads every setting from the environment', () => {
    const config = loadConfig({
      ...base,
      PORT: '8080',
      TRASH_RETENTION_DAYS: '7',
      LOG_LEVEL: 'debug',
    });
    expect(config.port).toBe(8080);
    expect(config.trashRetentionDays).toBe(7);
    expect(config.logLevels).toContain('debug');
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
