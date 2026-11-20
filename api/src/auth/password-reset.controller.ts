import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/public.decorator';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  /** Lets the sign-in page decide whether to show "Forgot password?". */
  @Public()
  @Get()
  status(): { enabled: boolean } {
    return { enabled: this.resets.enabled };
  }

  /** Always 204 for a well-formed address, with or without an account behind it. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  request(@Body() dto: RequestPasswordResetDto): void {
    this.resets.request(dto.email);
  }

  /** Sets a new password with the token from the mail and signs the account out everywhere. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirm(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.resets.reset(dto.token, dto.password);
  }
}
