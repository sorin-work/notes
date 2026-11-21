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
} from '@nestjs/common';
import type { MemberRole, NotebookInvite } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AccessService } from '../access/access.service';
import { failureKind, hashResetToken } from '../auth/password-reset.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { MailService, OutgoingMail } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

/** How long an invitation, and the link in its mail, works. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Open invitations a notebook can have at a time. */
export const MAX_OPEN_INVITES = 20;
/** Invitations one account can send in an hour. */
export const MAX_INVITES_PER_HOUR = 10;
/**
 * Invitations one account can send to one address in a day. Counted per
 * sender as well as per address, so that one account cannot use up the
 * allowance of an address and keep everyone else from inviting it.
 */
export const MAX_INVITES_PER_ADDRESS_PER_DAY = 3;

const INVITE_GONE = 'This invitation does not work any more. Ask for a new one.';

export interface MemberView {
  userId: string;
  name: string;
  /** Only for the owner. Members see each other's names, not their addresses. */
  email?: string;
  role: MemberRole;
  since: Date;
}

export interface InviteView {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  /**
   * The link to accept with, only in the answer to the invitation itself and
   * only when the server cannot send mail: the owner passes it on. It is
   * never stored, so it cannot be shown again.
   */
  link?: string;
}

/**
 * Like the reset mail, nothing in it comes from an account: neither the name
 * of the notebook nor that of whoever invited. Anyone can sign up and invite
 * any address, and must not get to write part of a mail to a stranger. The
 * invited person sees the notebook, and whose it is, once they have joined.
 * The link is the invitation: whoever opens it while signed in joins, so the
 * mail says to open it signed in to the account that should join.
 */
export function inviteMail(to: string, link: string): OutgoingMail {
  return {
    to,
    subject: 'You are invited to a shared notebook on Notes',
    text: [
      'Hello,',
      '',
      'Someone invited you to a notebook on Notes. To join, open this link while you are signed in to the Notes account that should join, or create an account first and then open it:',
      '',
      link,
      '',
      'The link works once, for a week, for whoever opens it while signed in, so do not pass it on. If you do not know what this is about, ignore this mail.',
      '',
    ].join('\n'),
  };
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Who has the notebook, for its owner and its members. Open invitations only for the owner. */
  async list(
    userId: string,
    notebookId: string,
  ): Promise<{ owner: { name: string }; members: MemberView[]; invites: InviteView[] }> {
    const granted = await this.access.notebook(userId, notebookId, 'read');
    const notebook = await this.prisma.notebook.findUniqueOrThrow({
      where: { id: notebookId },
      include: {
        user: { select: { name: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
        invites: { where: { expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' } },
      },
    });
    return {
      owner: { name: notebook.user.name },
      members: notebook.members.map((member) => ({
        userId: member.user.id,
        name: member.user.name,
        ...(granted.access === 'owner' ? { email: member.user.email } : {}),
        role: member.role,
        since: member.createdAt,
      })),
      invites:
        granted.access === 'owner'
          ? notebook.invites.map(({ id, email, role, expiresAt }) => ({ id, email, role, expiresAt }))
          : [],
    };
  }

  /**
   * Invites an address. The invitation is accepted with the token of its
   * link, which goes out by mail when the server can send mail, and is
   * otherwise handed to the owner once, in this answer, to pass on. Inviting
   * an address again renews its invitation with a new token and role.
   */
  async invite(
    ownerId: string,
    notebookId: string,
    email: string,
    role: MemberRole,
    now = new Date(),
  ): Promise<InviteView> {
    await this.access.notebook(ownerId, notebookId, 'owner');
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true } });
    if (owner.email === email) throw new BadRequestException('This notebook is yours already.');
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (
      existing &&
      (await this.prisma.notebookMember.findUnique({
        where: { notebookId_userId: { notebookId, userId: existing.id } },
      }))
    ) {
      throw new ConflictException('This address is a member already. Change its role instead.');
    }

    const token = randomBytes(32).toString('base64url');
    const invite = await this.prisma.$transaction(async (tx) => {
      // Invitations by one account wait for each other here, so the limits below count right.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerId}::uuid FOR UPDATE`;
      const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      await tx.inviteSend.deleteMany({ where: { sentAt: { lte: day } } });
      await tx.notebookInvite.deleteMany({ where: { expiresAt: { lte: now } } });
      // Counted from the sends, which only ever grow within the hour and the
      // day: withdrawing or renewing an invitation does not make room.
      const lastHour = await tx.inviteSend.count({
        where: { invitedById: ownerId, sentAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
      });
      if (lastHour >= MAX_INVITES_PER_HOUR) {
        throw new HttpException(
          'That is a lot of invitations for one hour. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const toAddress = await tx.inviteSend.count({ where: { invitedById: ownerId, email, sentAt: { gt: day } } });
      if (toAddress >= MAX_INVITES_PER_ADDRESS_PER_DAY) {
        throw new HttpException(
          'You have sent this address enough invitations for today. Try again tomorrow.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const open = await tx.notebookInvite.count({ where: { notebookId, email: { not: email } } });
      if (open >= MAX_OPEN_INVITES)
        throw new BadRequestException('This notebook has as many open invitations as it can.');
      await tx.inviteSend.create({ data: { invitedById: ownerId, email, sentAt: now } });
      const data = {
        role,
        tokenHash: hashResetToken(token),
        invitedById: ownerId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      };
      return tx.notebookInvite.upsert({
        where: { notebookId_email: { notebookId, email } },
        create: { notebookId, email, ...data },
        update: data,
      });
    });

    // In the fragment, as with the reset link, so the token stays out of access logs.
    const link = `${this.config.appUrl}/invites#token=${token}`;
    const view: InviteView = { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
    if (!this.mail.enabled) return { ...view, link };
    this.mail.send(inviteMail(email, link)).catch((error: unknown) => {
      this.logger.error(`Could not send an invitation mail (${failureKind(error)})`);
    });
    return view;
  }

  /** Withdraws an invitation that is still open. */
  async revoke(ownerId: string, notebookId: string, inviteId: string): Promise<void> {
    await this.access.notebook(ownerId, notebookId, 'owner');
    await this.prisma.notebookInvite.deleteMany({ where: { id: inviteId, notebookId } });
  }

  async changeRole(ownerId: string, notebookId: string, memberId: string, role: MemberRole): Promise<void> {
    await this.access.notebook(ownerId, notebookId, 'owner');
    const changed = await this.prisma.notebookMember.updateMany({
      where: { notebookId, userId: memberId },
      data: { role },
    });
    if (changed.count === 0) throw new NotFoundException('No such member');
  }

  /**
   * Takes a member out: the owner removing someone, or a member leaving. From
   * the next request on they see nothing of the notebook.
   */
  async remove(userId: string, notebookId: string, memberId: string): Promise<void> {
    const granted = await this.access.notebook(userId, notebookId, 'read');
    if (granted.access !== 'owner' && memberId !== userId) {
      throw new ForbiddenException('Only the owner of the notebook can remove someone else.');
    }
    const removed = await this.prisma.notebookMember.deleteMany({ where: { notebookId, userId: memberId } });
    if (removed.count === 0) throw new NotFoundException('No such member');
  }

  /**
   * Accepts an invitation by the token of its link, the only way to accept
   * one. As with a reset link, the token works once and only until it runs
   * out. The account that presents it joins, whatever its address: the token
   * is the proof, not an address, which nobody here has checked.
   */
  async acceptByToken(userId: string, token: string): Promise<{ notebookId: string }> {
    const invite = await this.prisma.notebookInvite.findUnique({ where: { tokenHash: hashResetToken(token) } });
    return this.join(userId, invite);
  }

  private async join(userId: string, invite: NotebookInvite | null, now = new Date()): Promise<{ notebookId: string }> {
    if (!invite || invite.expiresAt.getTime() <= now.getTime()) throw new NotFoundException(INVITE_GONE);
    const notebook = await this.prisma.notebook.findUnique({
      where: { id: invite.notebookId },
      select: { userId: true },
    });
    if (!notebook) throw new NotFoundException(INVITE_GONE);
    if (notebook.userId === userId) throw new BadRequestException('This notebook is yours already.');
    await this.prisma.$transaction(async (tx) => {
      // Used once: the delete decides which of two accepts at the same moment counts.
      const used = await tx.notebookInvite.deleteMany({ where: { id: invite.id } });
      if (used.count === 0) throw new NotFoundException(INVITE_GONE);
      await tx.notebookMember.upsert({
        where: { notebookId_userId: { notebookId: invite.notebookId, userId } },
        create: { notebookId: invite.notebookId, userId, role: invite.role },
        update: { role: invite.role },
      });
    });
    return { notebookId: invite.notebookId };
  }
}
