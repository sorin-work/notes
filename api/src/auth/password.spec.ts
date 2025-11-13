import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('accepts the right password and rejects others', async () => {
    const hash = await hashPassword('correct-horse');
    expect(hash).not.toContain('correct-horse');
    await expect(verifyPassword('correct-horse', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-horse', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});
