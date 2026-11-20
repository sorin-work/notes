import type { LogLevel } from '@nestjs/common';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface MailConfig {
  host: string;
  port: number;
  /** The From header, e.g. "Notes <notes@example.com>". */
  from: string;
  user?: string;
  password?: string;
  /**
   * Refuse to send unless the connection is encrypted. On by default: with
   * STARTTLS "when offered", whoever sits between the API and the mail
   * server only has to hide the offer to read the login and the reset links.
   */
  requireTls: boolean;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
  logLevels: LogLevel[];
  seedDemo: boolean;
  trashRetentionDays: number;
  authThrottleLimit: number;
  /** Null without SMTP_HOST: no mail is sent and password reset is off. */
  mail: MailConfig | null;
  /** Where people reach the web app, for the links in mails. No trailing slash. */
  appUrl: string;
  /**
   * How many reverse proxies stand between the clients and the API. With 0
   * the address of the connection counts as the client, which behind a proxy
   * is the proxy for everyone. With 1 it is the address the proxy reports.
   */
  trustProxy: number;
}

const LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
const LEVEL_ALIASES: Record<string, LogLevel> = { info: 'log', warning: 'warn' };

export class ConfigError extends Error {}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function toInt(name: string, value: string | undefined, fallback: number, min = 0): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new ConfigError(`${name} must be an integer of at least ${min}, got "${value}"`);
  }
  return parsed;
}

/** Turns LOG_LEVEL into the list of Nest log levels at or above it. */
export function logLevelsFrom(value: string | undefined): LogLevel[] {
  const name = (value ?? 'info').trim().toLowerCase();
  const level = LEVEL_ALIASES[name] ?? (name as LogLevel);
  const index = LEVELS.indexOf(level);
  if (index === -1) {
    throw new ConfigError(`LOG_LEVEL must be one of debug, info, warn or error, got "${value}"`);
  }
  return LEVELS.slice(0, index + 1);
}

/** For switches that are on unless someone says no: a typo must not turn them off. */
function saysNo(value: string | undefined): boolean {
  return ['0', 'false', 'no', 'off'].includes((value ?? '').trim().toLowerCase());
}

function mailFrom(env: NodeJS.ProcessEnv): MailConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const from = env.SMTP_FROM?.trim();
  if (!from) {
    throw new ConfigError('SMTP_FROM is required when SMTP_HOST is set');
  }
  return {
    host,
    port: toInt('SMTP_PORT', env.SMTP_PORT, 587, 1),
    from,
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD || undefined,
    requireTls: !saysNo(env.SMTP_REQUIRE_TLS),
  };
}

/**
 * Links in mails must not depend on what a request claims its host is. Once
 * mail is on there is no default either: a forgotten APP_URL would mail
 * links to localhost without a word.
 */
function appUrlFrom(value: string | undefined, mailIsOn: boolean): string {
  const given = (value ?? '').trim();
  if (!given && mailIsOn) {
    throw new ConfigError('APP_URL is required when SMTP_HOST is set: the links in mails start with it');
  }
  const raw = given || 'http://localhost:5181';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`APP_URL must be a URL such as https://notes.example.com, got "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`APP_URL must start with http:// or https://, got "${raw}"`);
  }
  return raw.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigError('DATABASE_URL is required');
  }
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new ConfigError('JWT_SECRET must be at least 32 characters long');
  }

  const mail = mailFrom(env);
  return {
    port: toInt('PORT', env.PORT, 4401, 1),
    databaseUrl,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    logLevels: logLevelsFrom(env.LOG_LEVEL),
    seedDemo: toBool(env.SEED_DEMO, false),
    trashRetentionDays: toInt('TRASH_RETENTION_DAYS', env.TRASH_RETENTION_DAYS, 30, 1),
    authThrottleLimit: toInt('AUTH_THROTTLE_LIMIT', env.AUTH_THROTTLE_LIMIT, 10, 1),
    mail,
    appUrl: appUrlFrom(env.APP_URL, mail !== null),
    trustProxy: toInt('TRUST_PROXY', env.TRUST_PROXY, 0, 0),
  };
}
