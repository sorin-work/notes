import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { AccountThrottlerGuard } from './account-throttler.guard';
import { AuthResult, AuthService } from './auth.service';
import { ConfirmTwoStepDto, EnableTwoStepDto, StartTwoStepDto } from './dto/two-step.dto';
import { TwoStepService, TwoStepSetup, TwoStepStatus } from './two-step.service';

/**
 * Two-step sign-in with codes from an authenticator app. Login only: an API
 * token cannot turn codes on or off. Everything that checks the password or
 * a code is throttled like the other routes that check the password, in the
 * same bucket per account.
 */
@Controller('auth/two-step')
export class TwoStepController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoStep: TwoStepService,
  ) {}

  /** Whether codes are on, how many recovery codes are left, and whether this server can do codes at all. */
  @Get()
  status(@CurrentUser() user: AuthUser): Promise<TwoStepStatus> {
    return this.twoStep.status(user.id);
  }

  /** Makes a new secret for the app, with the address for a QR code. Codes are not on until `enable`. */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Post('setup')
  async setup(@CurrentUser() user: AuthUser, @Body() dto: StartTwoStepDto): Promise<TwoStepSetup> {
    await this.auth.assertPassword(user.id, dto.currentPassword);
    return this.twoStep.begin(user.id);
  }

  /**
   * Turns codes on with the first code from the app. The answer holds the
   * ten recovery codes, the only time they are shown, and a new token:
   * every other session ends.
   */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Post('enable')
  async enable(
    @CurrentUser() user: AuthUser,
    @Body() dto: EnableTwoStepDto,
  ): Promise<AuthResult & { recoveryCodes: string[] }> {
    const recoveryCodes = await this.twoStep.enable(user.id, dto.code);
    return { ...(await this.auth.renew(user.id)), recoveryCodes };
  }

  /** Turns codes off. Takes the password and a code, or a recovery code. */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@CurrentUser() user: AuthUser, @Body() dto: ConfirmTwoStepDto): Promise<void> {
    await this.auth.assertPassword(user.id, dto.currentPassword);
    await this.twoStep.assertCode(user.id, dto.code);
    await this.twoStep.disable(user.id);
  }

  /** Ten new recovery codes in place of the old ones, which stop working. Takes the password and a code. */
  @UseGuards(ThrottlerGuard, AccountThrottlerGuard)
  @Post('recovery-codes')
  async recoveryCodes(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmTwoStepDto,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.auth.assertPassword(user.id, dto.currentPassword);
    await this.twoStep.assertCode(user.id, dto.code);
    return { recoveryCodes: await this.twoStep.newRecoveryCodes(user.id) };
  }
}
