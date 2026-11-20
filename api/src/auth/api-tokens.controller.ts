import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { AccountThrottlerGuard } from './account-throttler.guard';
import { ApiTokensService, ApiTokenView, CreatedApiToken } from './api-tokens.service';
import { AuthService } from './auth.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';

/**
 * Tokens are managed from a login. A token cannot list, make or revoke
 * tokens: nothing here is marked @AllowApiToken().
 */
@Controller('auth/tokens')
export class ApiTokensController {
  constructor(
    private readonly tokens: ApiTokensService,
    private readonly auth: AuthService,
  ) {}

  /** The API tokens of the account, without the tokens themselves. */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ApiTokenView[]> {
    return this.tokens.list(user.id);
  }

  /**
   * Makes a token. Needs `currentPassword`, and the answer is the only place the token itself ever appears.
   *
   * Throttled with the other routes that check the password, in the same
   * bucket per account.
   */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiTokenDto): Promise<CreatedApiToken> {
    await this.auth.assertPassword(user.id, dto.currentPassword);
    return this.tokens.create(user.id, dto);
  }

  /** Revokes every token of the account at once, for after a password change. */
  @Delete()
  revokeAll(@CurrentUser() user: AuthUser): Promise<{ revoked: number }> {
    return this.tokens.revokeAll(user.id);
  }

  /** Revokes a token. Whatever uses it gets a `401` from then on. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tokens.revoke(user.id, id);
  }
}
