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
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Everything here that is not public needs a login. An API token gets as far
 * as "who am I", the one route marked for it, and no further: it cannot
 * change the name, email or password, delete the account or sign out
 * everywhere.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.auth.register(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto);
  }

  @AllowApiToken()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  // The three routes below check the password, so they are throttled like
  // login: a stolen session must not be a way to guess it without limit.
  // Twice over: per client address on each route, and per account across
  // the three of them, so one account gets AUTH_THROTTLE_LIMIT guesses a
  // minute however they are spread.
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.auth.updateProfile(user.id, dto);
  }

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

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutEverywhere(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.logoutEverywhere(user.id);
  }
}
