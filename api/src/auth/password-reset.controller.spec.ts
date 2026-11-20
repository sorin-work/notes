import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetController', () => {
  let controller: PasswordResetController;
  const resets = { enabled: true, request: jest.fn(), reset: jest.fn() };
  const auth = { issue: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      controllers: [PasswordResetController],
      providers: [
        { provide: PasswordResetService, useValue: resets },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    controller = moduleRef.get(PasswordResetController);
  });

  it('says whether password reset is available', () => {
    expect(controller.status()).toEqual({ enabled: true });
    resets.enabled = false;
    expect(controller.status()).toEqual({ enabled: false });
  });

  it('hands the address to the service', () => {
    expect(controller.request({ email: 'ada@example.com' })).toBeUndefined();
    expect(resets.request).toHaveBeenCalledWith('ada@example.com');
  });

  it('sets the password and signs the browser in with a token for the account as it is now', async () => {
    const user = { id: 'user-1', tokenVersion: 3 };
    resets.reset.mockResolvedValue(user);
    auth.issue.mockResolvedValue({ token: 'fresh', user: { id: 'user-1' } });

    await expect(controller.confirm({ token: 'tok', password: 'battery-staple' })).resolves.toEqual({
      token: 'fresh',
      user: { id: 'user-1' },
    });

    expect(resets.reset).toHaveBeenCalledWith('tok', 'battery-staple');
    expect(auth.issue).toHaveBeenCalledWith(user);
  });
});
