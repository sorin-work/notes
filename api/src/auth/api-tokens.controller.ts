import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { SessionOnly } from '../common/session-only.decorator';
import { ApiTokensService, ApiTokenView, CreatedApiToken } from './api-tokens.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';

/** Tokens are managed from a login. A token cannot list, make or revoke tokens. */
@SessionOnly()
@Controller('auth/tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  /** The API tokens of the account, without the tokens themselves. */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ApiTokenView[]> {
    return this.tokens.list(user.id);
  }

  /** The answer is the only place the token itself ever appears. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiTokenDto): Promise<CreatedApiToken> {
    return this.tokens.create(user.id, dto);
  }

  /** Revokes a token. Whatever uses it gets a `401` from then on. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tokens.revoke(user.id, id);
  }
}
