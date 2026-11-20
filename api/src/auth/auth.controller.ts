import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AccountThrottlerGuard } from './account-throttler.guard';
import { AuthResult, AuthService, PublicUser } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { Preferences } from './preferences';

/**
 * Everything here that is not public needs a login. An API token gets as far
 * as "who am I", the one route marked for it, and no further: it cannot
 * change the name, email or password, delete the account or sign out
 * everywhere.
 *
 * The three routes that check the password (profile, delete, password) are
 * throttled like login, so that a stolen session is not a way to guess it
 * without limit. Twice over: per client address on each route, and per
 * account across the three of them, so one account gets AUTH_THROTTLE_LIMIT
 * guesses a minute however they are spread.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Creates an account and signs in. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.auth.register(dto);
  }

  /** Signs in. The `token` in the answer goes into the Authorization header. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto);
  }

  /** The account the credential belongs to. */
  @AllowApiToken()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  /** Changes the name or the email. A new email needs `currentPassword`. */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.auth.updateProfile(user.id, dto);
  }

  /**
   * Changes the choices kept with the account, such as where daily notes go.
   * They come back with `GET /auth/me`. Only what is sent changes.
   */
  @Patch('preferences')
  updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto): Promise<Preferences> {
    return this.auth.updatePreferences(user.id, dto);
  }

  /** Deletes the account with everything in it. */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAccount(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto): Promise<void> {
    return this.auth.deleteAccount(user.id, dto);
  }

  /** Answers with a new token: the old one stopped working with the old password. */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Patch('password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<AuthResult> {
    return this.auth.changePassword(user.id, dto);
  }

  /** Ends every login of the account. API tokens keep working. */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutEverywhere(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.logoutEverywhere(user.id);
  }
}
