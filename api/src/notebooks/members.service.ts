import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
/** Invitations one account can send in an hour, so the mail cannot be used to flood an address. */
export const MAX_INVITES_PER_HOUR = 10;

const INVITE_GONE = 'This invitation does not work any more. Ask for a new one.';

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  since: Date;
}

export interface InviteView {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
}

/** An invitation as the invited account sees it in the app. */
export interface ReceivedInvite {
  id: string;
  notebook: { id: string; name: string };
  from: { name: string };
  role: MemberRole;
  expiresAt: Date;
}

/**
 * Like the reset mail, nothing in it comes from an account: neither the name
 * of the notebook nor that of whoever invited. Anyone can sign up and invite
 * any address, and must not get to write part of a mail to a stranger. The
 * invited person sees who invited them, and to what, once signed in.
 */
export function inviteMail(to: string, link: string): OutgoingMail {
  return {
    to,
    subject: 'You are invited to a shared notebook on Notes',
    text: [
      'Hello,',
      '',
      'Someone invited this address to a notebook on Notes. To see who, and to accept, sign in with this address, or create an account with it, and open this link:',
      '',
      link,
      '',
      'The invitation works for a week. If you do not know what this is about, ignore this mail.',
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
        email: member.user.email,
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
   * Invites an address. An account that has it sees the invitation in the
   * app; a mail with a link goes out as well when the server can send mail.
   * Inviting an address again renews its invitation with the new role.
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
      await tx.notebookInvite.deleteMany({ where: { expiresAt: { lte: now } } });
      const lastHour = await tx.notebookInvite.count({
        where: { invitedById: ownerId, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
      });
      if (lastHour >= MAX_INVITES_PER_HOUR) {
        throw new BadRequestException('That is a lot of invitations for one hour. Try again later.');
      }
      const open = await tx.notebookInvite.count({ where: { notebookId, email: { not: email } } });
      if (open >= MAX_OPEN_INVITES)
        throw new BadRequestException('This notebook has as many open invitations as it can.');
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

    if (this.mail.enabled) {
      // In the fragment, as with the reset link, so the token stays out of access logs.
      this.mail.send(inviteMail(email, `${this.config.appUrl}/invites#token=${token}`)).catch((error: unknown) => {
        this.logger.error(`Could not send an invitation mail (${failureKind(error)})`);
      });
    }
    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
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

  /** The open invitations to the address of this account. */
  async received(userId: string, now = new Date()): Promise<ReceivedInvite[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const invites = await this.prisma.notebookInvite.findMany({
      where: { email: user.email, expiresAt: { gt: now } },
      include: { notebook: { select: { id: true, name: true } }, invitedBy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return invites.map((invite) => ({
      id: invite.id,
      notebook: invite.notebook,
      from: { name: invite.invitedBy.name },
      role: invite.role,
      expiresAt: invite.expiresAt,
    }));
  }

  /** Accepts an invitation in the app. Only the account with the invited address can. */
  async accept(userId: string, inviteId: string): Promise<{ notebookId: string }> {
    const invite = await this.prisma.notebookInvite.findUnique({ where: { id: inviteId } });
    return this.join(userId, invite);
  }

  /**
   * Accepts an invitation by the token in its mail. As with a reset link, the
   * token works once and only until it runs out. It is also tied to the
   * address it went to: whoever is signed in has to have that address, so a
   * forwarded link is no use to someone else.
   */
  async acceptByToken(userId: string, token: string): Promise<{ notebookId: string }> {
    const invite = await this.prisma.notebookInvite.findUnique({ where: { tokenHash: hashResetToken(token) } });
    return this.join(userId, invite);
  }

  /** Turns an invitation down. It goes, and the owner can invite again. */
  async decline(userId: string, inviteId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    await this.prisma.notebookInvite.deleteMany({ where: { id: inviteId, email: user.email } });
  }

  private async join(userId: string, invite: NotebookInvite | null, now = new Date()): Promise<{ notebookId: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    if (!invite || invite.expiresAt.getTime() <= now.getTime()) throw new NotFoundException(INVITE_GONE);
    if (invite.email !== user.email) {
      throw new ForbiddenException('This invitation is for another address. Sign in with the address it was sent to.');
    }
    const notebook = await this.prisma.notebook.findUnique({
      where: { id: invite.notebookId },
      select: { userId: true },
    });
    if (!notebook || notebook.userId === userId) throw new NotFoundException(INVITE_GONE);
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
