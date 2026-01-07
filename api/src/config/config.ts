import type { LogLevel } from '@nestjs/common';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  logLevels: LogLevel[];
  trashRetentionDays: number;
}

const LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
const LEVEL_ALIASES: Record<string, LogLevel> = { info: 'log', warning: 'warn' };

export class ConfigError extends Error {}

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigError('DATABASE_URL is required');
  }
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new ConfigError('JWT_SECRET must be at least 32 characters long');
  }

  return {
    port: toInt('PORT', env.PORT, 4401, 1),
    databaseUrl,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    logLevels: logLevelsFrom(env.LOG_LEVEL),
    trashRetentionDays: toInt('TRASH_RETENTION_DAYS', env.TRASH_RETENTION_DAYS, 30, 1),
  };
}
