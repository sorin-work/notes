import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetController', () => {
  let controller: PasswordResetController;
  const resets = { enabled: true, request: jest.fn(), reset: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      controllers: [PasswordResetController],
      providers: [{ provide: PasswordResetService, useValue: resets }],
    }).compile();
    controller = moduleRef.get(PasswordResetController);
  });

  it('says whether password reset is available', () => {
    expect(controller.status()).toEqual({ enabled: true });
    resets.enabled = false;
    expect(controller.status()).toEqual({ enabled: false });
  });

  it('hands the address and the new password to the service', async () => {
    expect(controller.request({ email: 'ada@example.com' })).toBeUndefined();
    expect(resets.request).toHaveBeenCalledWith('ada@example.com');
    await controller.confirm({ token: 'tok', password: 'battery-staple' });
    expect(resets.reset).toHaveBeenCalledWith('tok', 'battery-staple');
  });
});
