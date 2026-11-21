import { ConflictException, ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { base32Decode, base32Encode, codeAt, matchingStep, otpauthUri, stepAt } from './totp';
import {
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
} from './two-step-crypto';
import { TwoStepService, wrongCodeMail } from './two-step.service';

// The secret of the test vectors in RFC 4226 and RFC 6238 (SHA-1).
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('totp', () => {
  it('makes the codes of RFC 4226 for the first counters', () => {
    expect([0, 1, 2, 3, 9].map((step) => codeAt(RFC_SECRET, step))).toEqual([
      '755224',
      '287082',
      '359152',
      '969429',
      '520489',
    ]);
  });

  it('makes the codes of RFC 6238 at its times, cut to six digits', () => {
    const at = (seconds: number) => codeAt(RFC_SECRET, stepAt(new Date(seconds * 1000)));
    expect(at(59)).toBe('287082');
    expect(at(1111111109)).toBe('081804');
    expect(at(1234567890)).toBe('005924');
    expect(at(2000000000)).toBe('279037');
  });

  it('finds the step of a code one step either side of now, and no further', () => {
    const now = new Date(1234567890 * 1000);
    const step = stepAt(now);
    expect(matchingStep(RFC_SECRET, codeAt(RFC_SECRET, step), now)).toBe(step);
    expect(matchingStep(RFC_SECRET, codeAt(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchingStep(RFC_SECRET, codeAt(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchingStep(RFC_SECRET, codeAt(RFC_SECRET, step + 2), now)).toBeNull();
    expect(matchingStep(RFC_SECRET, '12345', now)).toBeNull();
  });

  it('writes the secret in base32 and the address apps read', () => {
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv-gy3tqojqgezdgnbvgy3tqojq')).toEqual(RFC_SECRET);
    const uri = new URL(otpauthUri(RFC_SECRET, 'ada@example.com'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Notes:ada@example.com');
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      issuer: 'Notes',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});

describe('two-step-crypto', () => {
  const key = Buffer.alloc(32, 1);

  it('decrypts what it encrypted, for the same account and key only', () => {
    const stored = encryptSecret(key, 'user-1', RFC_SECRET);
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain(base32Encode(RFC_SECRET));
    expect(decryptSecret(key, 'user-1', stored)).toEqual(RFC_SECRET);
    expect(() => decryptSecret(key, 'user-2', stored)).toThrow();
    expect(() => decryptSecret(Buffer.alloc(32, 2), 'user-1', stored)).toThrow();
    // Two encryptions of one secret look nothing alike.
    expect(encryptSecret(key, 'user-1', RFC_SECRET)).not.toBe(stored);
  });

  it('makes recovery codes of 16 letters and digits, read whatever the case and dashes', () => {
    const codes = new Set(Array.from({ length: 50 }, newRecoveryCode));
    expect(codes.size).toBe(50);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
      expect(looksLikeRecoveryCode(code.toUpperCase())).toBe(true);
    }
    expect(normalizeRecoveryCode(' ABCD-efgh jkmn-PQRS ')).toBe('abcdefghjkmnpqrs');
    expect(hashRecoveryCode('ABCD-EFGH-JKMN-PQRS')).toBe(hashRecoveryCode('abcdefghjkmnpqrs'));
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});

describe('TwoStepService', () => {
  const key = Buffer.alloc(32, 3);
  const now = new Date('2026-11-21T12:00:00Z');
  const user = {
    id: '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e',
    email: 'ada@example.com',
    twoStepSecret: null as string | null,
    twoStepSince: null as Date | null,
    twoStepLastStep: null as number | null,
  };
  let prisma: PrismaMock;
  let service: TwoStepService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new TwoStepService(asPrismaService(prisma), { authThrottleLimit: 10, twoStepKey: key } as AppConfig);
  });

  it('keeps a new secret encrypted until the first code turns codes on with ten recovery codes', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    const setup = await service.begin(user.id);
    const stored = prisma.user.update.mock.calls[0][0].data.twoStepSecret as string;
    expect(decryptSecret(key, user.id, stored)).toEqual(base32Decode(setup.secret));
    expect(setup.uri).toContain(`secret=${setup.secret}`);

    prisma.user.findUnique.mockResolvedValue({ ...user, twoStepSecret: stored });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.enable(user.id, '000000', now)).rejects.toBeInstanceOf(ForbiddenException);
    const codes = await service.enable(user.id, codeAt(base32Decode(setup.secret), stepAt(now)), now);
    expect(codes).toHaveLength(10);
    const kept = prisma.recoveryCode.createMany.mock.calls[0][0].data as { codeHash: string }[];
    expect(kept.map((row) => row.codeHash)).toEqual(codes.map(hashRecoveryCode));
    // Only while codes are off. Every other session was signed in without a code, so they end.
    expect(prisma.user.updateMany).toHaveBeenLastCalledWith({
      where: { id: user.id, twoStepSince: null },
      data: { twoStepSince: now, twoStepLastStep: stepAt(now), tokenVersion: { increment: 1 } },
    });
  });

  it('gives the second of two enables at once a 409, and keeps the recovery codes of the first', async () => {
    const stored = encryptSecret(key, user.id, RFC_SECRET);
    prisma.user.findUnique.mockResolvedValue({ ...user, twoStepSecret: stored });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.enable(user.id, codeAt(RFC_SECRET, stepAt(now)), now)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.recoveryCode.deleteMany).not.toHaveBeenCalled();
    expect(prisma.recoveryCode.createMany).not.toHaveBeenCalled();
  });

  it('says once at start when the key does not decrypt the stored secrets', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    prisma.user.findFirst.mockResolvedValue({
      id: user.id,
      twoStepSecret: encryptSecret(Buffer.alloc(32, 4), user.id, RFC_SECRET),
    });
    await service.onApplicationBootstrap();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('TWO_STEP_KEY does not decrypt'));
    error.mockClear();
    prisma.user.findFirst.mockResolvedValue({ id: user.id, twoStepSecret: encryptSecret(key, user.id, RFC_SECRET) });
    await service.onApplicationBootstrap();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not start again while codes are on, and cannot start without a key', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, twoStepSince: now });
    await expect(service.begin(user.id)).rejects.toBeInstanceOf(ConflictException);
    const keyless = new TwoStepService(asPrismaService(prisma), {
      authThrottleLimit: 10,
      twoStepKey: null,
    } as AppConfig);
    expect(keyless.available).toBe(false);
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(keyless.begin(user.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('asks for a code only when codes are on', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.assertCode(user.id, undefined)).resolves.toBeUndefined();
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      twoStepSince: now,
      twoStepSecret: encryptSecret(key, user.id, RFC_SECRET),
    });
    await expect(service.assertCode(user.id, undefined)).rejects.toThrow('is needed too');
    await expect(service.assertCode(user.id, '000000')).rejects.toThrow('That code is not right');
  });

  it('tells the owner about a wrong code at most once an hour, in a mail that says nothing it was given', () => {
    const mail = { enabled: true, send: jest.fn().mockResolvedValue(undefined) };
    const withMail = new TwoStepService(
      asPrismaService(prisma),
      { authThrottleLimit: 10, twoStepKey: key } as AppConfig,
      mail as never,
    );
    const owner = { ...user, twoStepSince: now } as never;
    withMail.warnOwner(owner, 0);
    withMail.warnOwner(owner, 30 * 60 * 1000);
    withMail.warnOwner(owner, 61 * 60 * 1000);
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(mail.send).toHaveBeenCalledWith(wrongCodeMail(user.email));
  });
});
