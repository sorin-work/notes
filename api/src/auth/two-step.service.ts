import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  OnApplicationBootstrap,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config/config';
import { MailService, OutgoingMail } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { failureKind } from './password-reset.service';
import { base32Encode, looksLikeTotp, matchingStep, newTotpSecret, otpauthUri } from './totp';
import {
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  newRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './two-step-crypto';

/** Wrong codes one ticket may take before it is used up and the password has to be given again. */
export const CODES_PER_TICKET = 5;
/** Wrong codes an account may take in an hour, from all addresses together, before codes from the app are refused. */
export const WRONG_CODES_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const NO_KEY = 'Codes from the app cannot be checked on this server (TWO_STEP_KEY). A recovery code still works.';
const WINDOW_MS = 60_000;
const SWEEP_ABOVE = 1000;
/** The owner hears about wrong codes at most this often. */
const WARN_EVERY_MS = 60 * 60 * 1000;

export class TooManyCodes extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Counts the codes tried at sign-in:
 *
 * - Per account and client address, AUTH_THROTTLE_LIMIT a minute.
 * - Per ticket, CODES_PER_TICKET in all, and a ticket that signed someone
 *   in is spent: it cannot make a second token. A ticket is what the right
 *   password gets, so each batch of guesses costs a sign-in with the
 *   password, which is throttled per address too.
 * - Per account from all addresses, WRONG_CODES_PER_HOUR wrong codes an
 *   hour. Past that, codes from the app are refused for the rest of the
 *   hour and recovery codes still work. This one could hold the owner up,
 *   but only someone who has the password can use it up, and the owner is
 *   mailed when that happens (TwoStepService.warnOwner).
 *
 * Six digits are a million codes, of which three are right at any moment.
 * With the cap, someone who has the password and guesses from many
 * addresses gets 480 codes a day, about one chance in 700 a day, while the
 * owner is mailed about it every hour. Kept in the memory of this
 * process, like the other throttles.
 */
export class CodeAttempts {
  private readonly windows = new Map<string, { used: number; until: number }>();
  private readonly tickets = new Map<string, { used: number; until: number; spent?: boolean }>();
  private readonly wrong = new Map<string, { used: number; until: number }>();

  constructor(private readonly limit: number) {}

  /** Takes one attempt. Throws when the ticket is spent or used up, or the address has had its codes. */
  take(userId: string, address: string, ticketId: string, ticketExpires: number, now = Date.now()): void {
    if (this.windows.size >= SWEEP_ABOVE || this.tickets.size >= SWEEP_ABOVE || this.wrong.size >= SWEEP_ABOVE) {
      this.sweep(now);
    }
    const ticket = this.tickets.get(ticketId) ?? { used: 0, until: ticketExpires };
    if (ticket.spent) {
      throw new UnauthorizedException('Sign in with your password again: this sign-in is done.');
    }
    if (ticket.used >= CODES_PER_TICKET) {
      throw new TooManyCodes('Too many wrong codes. Sign in with your password again.');
    }
    const key = `${userId}|${address}`;
    let window = this.windows.get(key);
    if (!window || window.until <= now) {
      window = { used: 0, until: now + WINDOW_MS };
      this.windows.set(key, window);
    }
    if (window.used >= this.limit) {
      const seconds = Math.max(1, Math.ceil((window.until - now) / 1000));
      throw new TooManyCodes('Too many codes from here. Try again in a minute.', seconds);
    }
    window.used++;
    ticket.used++;
    this.tickets.set(ticketId, ticket);
  }

  /** Whether codes from the app are refused for the account this hour. Recovery codes are not. */
  capped(userId: string, now = Date.now()): boolean {
    const window = this.wrong.get(userId);
    return !!window && window.until > now && window.used >= WRONG_CODES_PER_HOUR;
  }

  /** A wrong code, counted against the account from wherever it came. */
  wrongCode(userId: string, now = Date.now()): void {
    let window = this.wrong.get(userId);
    if (!window || window.until <= now) {
      window = { used: 0, until: now + HOUR_MS };
      this.wrong.set(userId, window);
    }
    window.used++;
  }

  /**
   * The code was right: the attempt does not count against the address, and
   * the ticket is spent until it would have expired anyway.
   */
  succeeded(userId: string, address: string, ticketId: string, ticketExpires: number): void {
    const window = this.windows.get(`${userId}|${address}`);
    if (window && window.used > 0) window.used--;
    const ticket = this.tickets.get(ticketId) ?? { used: 0, until: ticketExpires };
    ticket.spent = true;
    this.tickets.set(ticketId, ticket);
  }

  private sweep(now: number): void {
    for (const map of [this.windows, this.tickets, this.wrong]) {
      for (const [key, entry] of map) if (entry.until <= now) map.delete(key);
    }
  }
}

export interface TwoStepStatus {
  /** False when the server has no TWO_STEP_KEY: codes cannot be turned on here. */
  available: boolean;
  on: boolean;
  recoveryCodesLeft: number;
}

export interface TwoStepSetup {
  /** For typing into the app by hand, in base32. */
  secret: string;
  /** For the QR code. */
  uri: string;
}

/** Nothing in it comes from whoever is signing in, so it cannot be made to say something else. */
export function wrongCodeMail(to: string): OutgoingMail {
  return {
    to,
    subject: 'Someone has your Notes password',
    text: [
      'Hello,',
      '',
      'Someone signed in to your Notes account with the right password, then gave a wrong code from the authenticator app.',
      '',
      'If that was you, there is nothing to do. If it was not, your password is known to someone else: change it in Settings. Without a code they cannot get in.',
      '',
    ].join('\n'),
  };
}

@Injectable()
export class TwoStepService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TwoStepService.name);
  readonly attempts: CodeAttempts;
  private readonly warned = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly mail?: MailService,
  ) {
    this.attempts = new CodeAttempts(config.authThrottleLimit);
  }

  get available(): boolean {
    return this.config.twoStepKey !== null;
  }

  /**
   * Says once, at start, when TWO_STEP_KEY is not the key the stored secrets
   * were made with, as after a restore onto a server with another key. Each
   * sign-in would otherwise only answer 503 without saying why.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.twoStepKey) return;
    let sample: { id: string; twoStepSecret: string | null } | null;
    try {
      sample = await this.prisma.user.findFirst({
        where: { twoStepSecret: { not: null } },
        select: { id: true, twoStepSecret: true },
      });
    } catch {
      // The database is not there yet: nothing to check against.
      return;
    }
    if (!sample?.twoStepSecret) return;
    try {
      decryptSecret(this.config.twoStepKey, sample.id, sample.twoStepSecret);
    } catch {
      this.logger.error(
        'TWO_STEP_KEY does not decrypt the stored two-step secrets. Codes from the app will not work until the key they were made with is back. Recovery codes still do.',
      );
    }
  }

  isOn(user: Pick<User, 'twoStepSince'>): boolean {
    return user.twoStepSince !== null;
  }

  async status(userId: string): Promise<TwoStepStatus> {
    const user = await this.find(userId);
    return {
      available: this.available,
      on: this.isOn(user),
      recoveryCodesLeft: this.isOn(user) ? await this.prisma.recoveryCode.count({ where: { userId } }) : 0,
    };
  }

  /**
   * Makes a new secret and keeps it, encrypted, until the first code from
   * the app turns codes on. Starting again replaces it. The password has
   * been checked by the caller.
   */
  async begin(userId: string): Promise<TwoStepSetup> {
    const key = this.key();
    const user = await this.find(userId);
    if (this.isOn(user)) {
      throw new ConflictException('Two-step sign-in is already on');
    }
    const secret = newTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoStepSecret: encryptSecret(key, userId, secret), twoStepLastStep: null },
    });
    return { secret: base32Encode(secret), uri: otpauthUri(secret, user.email) };
  }

  /**
   * Turns codes on with the first code from the app, and answers the
   * recovery codes, the only time they are shown. Every other session ends:
   * they were signed in without a code. The caller issues a new token for
   * this one.
   */
  async enable(userId: string, code: string, now = new Date()): Promise<string[]> {
    const key = this.key();
    const user = await this.find(userId);
    if (this.isOn(user)) {
      throw new ConflictException('Two-step sign-in is already on');
    }
    if (!user.twoStepSecret) {
      throw new BadRequestException('Start setting up two-step sign-in first');
    }
    const step = looksLikeTotp(code) ? matchingStep(this.secretOf(key, user.id, user.twoStepSecret), code, now) : null;
    if (step === null) {
      throw new ForbiddenException('That code is not right. Check the time on the phone and try the next one.');
    }
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.$transaction(async (tx) => {
      // Only while codes are off, in the statement that turns them on: of two
      // requests at once, the second finds them on, gets a 409, and its
      // recovery codes are rolled back with it, so the first answer's stand.
      const turned = await tx.user.updateMany({
        where: { id: userId, twoStepSince: null },
        data: { twoStepSince: now, twoStepLastStep: step, tokenVersion: { increment: 1 } },
      });
      if (turned.count !== 1) {
        throw new ConflictException('Two-step sign-in is already on');
      }
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.recoveryCode.createMany({ data: codes.map((one) => ({ userId, codeHash: hashRecoveryCode(one) })) });
    });
    return codes;
  }

  /** Turns codes off and forgets the secret and the recovery codes. The caller has checked the password and a code. */
  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { twoStepSecret: null, twoStepSince: null, twoStepLastStep: null },
      }),
    ]);
  }

  /** A new set of recovery codes in place of the old one. The caller has checked the password and a code. */
  async newRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: codes.map((one) => ({ userId, codeHash: hashRecoveryCode(one) })) }),
    ]);
    return codes;
  }

  /**
   * Whether `code` is a code from the app or an unused recovery code of the
   * account, and if so uses it up. A code from the app is taken once: its
   * step has to come after the step of the last one taken, which is moved
   * in the same statement, so two requests with the same code cannot both
   * pass. A recovery code is deleted by the statement that finds it.
   */
  async check(user: User, code: string, now = new Date()): Promise<boolean> {
    if (looksLikeTotp(code)) {
      if (!user.twoStepSecret) return false;
      const step = matchingStep(this.secretOf(this.key(), user.id, user.twoStepSecret), code, now);
      if (step === null) return false;
      const taken = await this.prisma.user.updateMany({
        where: { id: user.id, OR: [{ twoStepLastStep: null }, { twoStepLastStep: { lt: step } }] },
        data: { twoStepLastStep: step },
      });
      return taken.count === 1;
    }
    if (looksLikeRecoveryCode(code)) {
      const used = await this.prisma.recoveryCode.deleteMany({
        where: { userId: user.id, codeHash: hashRecoveryCode(code) },
      });
      return used.count === 1;
    }
    return false;
  }

  /**
   * For the routes that ask for a code on top of the password: turning
   * codes off, new recovery codes, a new API token. Passes when codes are off.
   */
  async assertCode(userId: string, code: string | undefined): Promise<void> {
    const user = await this.find(userId);
    if (!this.isOn(user)) return;
    if (!code) {
      throw new ForbiddenException('A code from the authenticator app, or a recovery code, is needed too');
    }
    if (!(await this.check(user, code))) {
      throw new ForbiddenException('That code is not right');
    }
  }

  /**
   * Tells the owner that someone with the password gave a wrong code, at
   * most once an hour. Without mail, the log is all there is. Never throws.
   */
  warnOwner(user: User, now = Date.now()): void {
    const last = this.warned.get(user.id);
    if (last !== undefined && now - last < WARN_EVERY_MS) return;
    this.warned.set(user.id, now);
    if (this.warned.size > SWEEP_ABOVE) {
      for (const [id, at] of this.warned) if (now - at >= WARN_EVERY_MS) this.warned.delete(id);
    }
    if (!this.mail?.enabled) {
      this.logger.warn('A wrong two-step code was given after the right password');
      return;
    }
    this.mail.send(wrongCodeMail(user.email)).catch((error: unknown) => {
      this.logger.error(`Could not send the mail about a wrong two-step code (${failureKind(error)})`);
    });
  }

  /** A key that does not fit answers like a missing one: the codes cannot be checked here. */
  private secretOf(key: Buffer, userId: string, stored: string): Buffer {
    try {
      return decryptSecret(key, userId, stored);
    } catch {
      throw new ServiceUnavailableException(NO_KEY);
    }
  }

  private key(): Buffer {
    if (!this.config.twoStepKey) {
      throw new ServiceUnavailableException(NO_KEY);
    }
    return this.config.twoStepKey;
  }

  private async find(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
