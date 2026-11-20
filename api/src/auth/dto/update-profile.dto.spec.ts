import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

async function messages(body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(UpdateProfileDto, body), { whitelist: true });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('UpdateProfileDto', () => {
  it('lets any field be left out', async () => {
    expect(await messages({})).toEqual([]);
    expect(await messages({ name: 'Ada' })).toEqual([]);
    expect(await messages({ email: 'ADA@example.com ', currentPassword: 'secret' })).toEqual([]);
  });

  it('does not take null for a field that is left out', async () => {
    expect(await messages({ name: null })).toContain('name is required');
    expect(await messages({ email: null, currentPassword: 'secret' })).toContain('email must be a valid email address');
    expect(await messages({ name: 'Ada', currentPassword: null })).toContain('currentPassword must be a string');
  });

  it('trims the name and lower-cases the email', () => {
    const dto = plainToInstance(UpdateProfileDto, { name: '  Ada  ', email: ' Ada@Example.COM ' });
    expect(dto).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
  });
});
