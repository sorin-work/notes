import { AccessService } from '../access/access.service';
import type { AppConfig } from '../config/config';
import type { MailService } from '../mail/mail.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { MembersService } from './members.service';

describe('MembersService.invite', () => {
  let prisma: PrismaMock;
  const config = { appUrl: 'http://notes.test' } as AppConfig;

  function service(mailEnabled: boolean) {
    const mail = { enabled: mailEnabled, send: jest.fn().mockResolvedValue(undefined) };
    const access = { notebook: jest.fn().mockResolvedValue({ ownerId: 'owner', access: 'owner' }) };
    const members = new MembersService(
      asPrismaService(prisma),
      access as unknown as AccessService,
      mail as unknown as MailService,
      config,
    );
    return { members, mail };
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'owner@example.com' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.inviteSend.count.mockResolvedValue(0);
    prisma.notebookInvite.count.mockResolvedValue(0);
    prisma.notebookInvite.upsert.mockImplementation(({ create }) =>
      Promise.resolve({ id: 'i1', ...create, expiresAt: create.expiresAt }),
    );
  });

  it('hands the owner the link once when the server sends no mail, and stores only its hash', async () => {
    const { members, mail } = service(false);
    const sent = await members.invite('owner', 'nb', 'dee@example.com', 'read');
    expect(sent.link).toMatch(/^http:\/\/notes\.test\/invites#token=[\w-]{40,}$/);
    expect(mail.send).not.toHaveBeenCalled();
    const stored = prisma.notebookInvite.upsert.mock.calls[0][0].create;
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(sent.link!.split('#token=')[1]);
    // Each send is counted, apart from the invitation row.
    expect(prisma.inviteSend.create).toHaveBeenCalledWith({
      data: { invitedById: 'owner', email: 'dee@example.com', sentAt: expect.any(Date) },
    });
  });

  it('mails the link and never answers with it when the server sends mail', async () => {
    const { members, mail } = service(true);
    const sent = await members.invite('owner', 'nb', 'dee@example.com', 'edit');
    expect(sent).not.toHaveProperty('link');
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'dee@example.com' }));
  });

  it('refuses past three sends from one account to one address in a day, counting that sender only', async () => {
    prisma.inviteSend.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    const { members } = service(false);
    await expect(members.invite('owner', 'nb', 'dee@example.com', 'read')).rejects.toMatchObject({ status: 429 });
    expect(prisma.notebookInvite.upsert).not.toHaveBeenCalled();
    expect(prisma.inviteSend.count.mock.calls[1][0].where).toMatchObject({
      invitedById: 'owner',
      email: 'dee@example.com',
    });
  });

  it('says in the mail to open the link signed in to the account that should join', async () => {
    const { members, mail } = service(true);
    await members.invite('owner', 'nb', 'dee@example.com', 'read');
    const { text } = mail.send.mock.calls[0][0] as { text: string };
    expect(text).toContain('while you are signed in to the Notes account that should join');
    expect(text).toContain('for whoever opens it while signed in');
  });
});
