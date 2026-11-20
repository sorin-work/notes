import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';

/** How JwtAuthGuard tells an API token from a login token. */
export const API_TOKEN_PREFIX = 'nt_';
export const MAX_API_TOKENS = 20;

/** "Last used" is written this often at most, so reads stay reads. */
const LAST_USED_STEP_MS = 60_000;
const THROTTLE_WINDOW_MS = 60_000;

export interface ApiTokenView {
  id: string;
  name: string;
  readOnly: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** What creating a token answers with: the only time the token itself is given out. */
export interface CreatedApiToken extends ApiTokenView {
  token: string;
}

/** Who a request made with an API token acts as, and what the token may do. */
export interface ApiTokenIdentity {
  tokenId: string;
  userId: string;
  email: string;
  readOnly: boolean;
}

const VIEW = { id: true, name: true, readOnly: true, lastUsedAt: true, createdAt: true } as const;

export function isApiToken(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX);
}

/**
 * Only this hash is stored. The token has 256 random bits, so there is
 * nothing to guess and a fast hash will do.
 */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class ApiTokensService {
  private readonly logger = new Logger(ApiTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectThrottlerStorage() private readonly throttler: ThrottlerStorage,
  ) {}

  list(userId: string): Promise<ApiTokenView[]> {
    return this.prisma.apiToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: VIEW });
  }

  async create(userId: string, dto: CreateApiTokenDto): Promise<CreatedApiToken> {
    if ((await this.prisma.apiToken.count({ where: { userId } })) >= MAX_API_TOKENS) {
      throw new BadRequestException(`An account can have ${MAX_API_TOKENS} API tokens. Revoke one first.`);
    }
    const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const created = await this.prisma.apiToken.create({
      data: { userId, name: dto.name, readOnly: dto.readOnly ?? false, tokenHash: hashApiToken(token) },
      select: VIEW,
    });
    return { ...created, token };
  }

  async revoke(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.apiToken.deleteMany({ where: { id, userId } });
    if (count === 0) {
      throw new NotFoundException('API token not found');
    }
  }

  /** Who the token belongs to, or null for a token that does not exist (any more). */
  async identify(token: string, now = new Date()): Promise<ApiTokenIdentity | null> {
    const found = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashApiToken(token) },
      select: { id: true, userId: true, readOnly: true, lastUsedAt: true, user: { select: { email: true } } },
    });
    if (!found) {
      return null;
    }
    if (!found.lastUsedAt || now.getTime() - found.lastUsedAt.getTime() >= LAST_USED_STEP_MS) {
      await this.touch(found.id, now);
    }
    return { tokenId: found.id, userId: found.userId, email: found.user.email, readOnly: found.readOnly };
  }

  /**
   * Counts a request against the token's allowance. Answers 0 when it is
   * within API_TOKEN_THROTTLE_LIMIT a minute, otherwise the seconds to wait.
   */
  async throttle(tokenId: string): Promise<number> {
    const record = await this.throttler.increment(
      `api-token:${tokenId}`,
      THROTTLE_WINDOW_MS,
      this.config.apiTokenThrottleLimit,
      THROTTLE_WINDOW_MS,
      'api-token',
    );
    return record.isBlocked ? Math.max(1, record.timeToBlockExpire) : 0;
  }

  /** The condition makes of several requests at the same moment only one write. */
  private async touch(id: string, now: Date): Promise<void> {
    const before = new Date(now.getTime() - LAST_USED_STEP_MS);
    try {
      await this.prisma.apiToken.updateMany({
        where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: before } }] },
        data: { lastUsedAt: now },
      });
    } catch (error) {
      // Not worth failing the request over.
      this.logger.warn(`Could not note the use of an API token: ${error instanceof Error ? error.message : error}`);
    }
  }
}
