import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const auth = {
    register: jest.fn(),
    login: jest.fn(),
    me: jest.fn(),
    updateProfile: jest.fn(),
    deleteAccount: jest.fn(),
    changePassword: jest.fn(),
    logoutEverywhere: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    controller = moduleRef.get(AuthController);
  });

  it('passes registration details to the service', async () => {
    auth.register.mockResolvedValue({ token: 't', user: { id: '1' } });
    const dto = { email: 'ada@example.com', name: 'Ada', password: 'long-enough' };
    await expect(controller.register(dto)).resolves.toEqual({ token: 't', user: { id: '1' } });
    expect(auth.register).toHaveBeenCalledWith(dto);
  });

  it('logs in', async () => {
    auth.login.mockResolvedValue({ token: 't', user: { id: '1' } });
    await controller.login({ email: 'ada@example.com', password: 'pw' });
    expect(auth.login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'pw' });
  });

  it('looks up the current user by the id from the token', async () => {
    auth.me.mockResolvedValue({ id: '1' });
    await controller.me({ id: '1', email: 'ada@example.com' });
    expect(auth.me).toHaveBeenCalledWith('1');
  });

  it('changes the password of the current user and hands back the new token', async () => {
    auth.changePassword.mockResolvedValue({ token: 't2', user: { id: '1' } });
    const dto = { currentPassword: 'old-password', newPassword: 'new-password' };
    await expect(controller.changePassword({ id: '1', email: 'ada@example.com' }, dto)).resolves.toEqual({
      token: 't2',
      user: { id: '1' },
    });
    expect(auth.changePassword).toHaveBeenCalledWith('1', dto);
  });

  it('updates, signs out and deletes the current user', async () => {
    const current = { id: '1', email: 'ada@example.com' };
    await controller.updateProfile(current, { name: 'Ada L.' });
    expect(auth.updateProfile).toHaveBeenCalledWith('1', { name: 'Ada L.' });
    await controller.logoutEverywhere(current);
    expect(auth.logoutEverywhere).toHaveBeenCalledWith('1');
    await controller.deleteAccount(current, { password: 'pw' });
    expect(auth.deleteAccount).toHaveBeenCalledWith('1', { password: 'pw' });
  });
});
