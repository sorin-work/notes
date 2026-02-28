import { loadConfig } from '../config/config';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { DEMO_NOTES } from './demo-data';
import { DEMO_EMAIL, DemoSeedService } from './demo-seed.service';

const env = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };

describe('DemoSeedService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.user.create.mockResolvedValue({ id: 'demo' });
    prisma.notebook.create.mockImplementation(({ data }) => Promise.resolve({ id: `nb-${data.name}` }));
    prisma.tag.create.mockImplementation(({ data }) => Promise.resolve({ id: `tag-${data.name}` }));
    prisma.note.create.mockImplementation(({ data }) => Promise.resolve({ id: `note-${data.title}` }));
  });

  it('does nothing when SEED_DEMO is off', async () => {
    const service = new DemoSeedService(asPrismaService(prisma), loadConfig(env));
    await service.onApplicationBootstrap();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not seed twice', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'demo' });
    const service = new DemoSeedService(asPrismaService(prisma), loadConfig({ ...env, SEED_DEMO: 'true' }));
    await expect(service.seed()).resolves.toBe(false);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates the demo user with notebooks, notes, links, versions and shares', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const service = new DemoSeedService(asPrismaService(prisma), loadConfig({ ...env, SEED_DEMO: 'true' }));
    await expect(service.seed(new Date('2026-06-01T12:00:00Z'))).resolves.toBe(true);

    expect(prisma.user.create.mock.calls[0][0].data.email).toBe(DEMO_EMAIL);
    expect(prisma.note.create).toHaveBeenCalledTimes(DEMO_NOTES.length);
    expect(prisma.noteLink.createMany).toHaveBeenCalled();
    expect(prisma.noteVersion.create).toHaveBeenCalled();
    expect(prisma.shareLink.create).toHaveBeenCalled();
    const trashed = prisma.note.create.mock.calls.filter(([args]) => args.data.deletedAt !== null);
    expect(trashed.length).toBe(DEMO_NOTES.filter((note) => note.trashedDaysAgo !== undefined).length);
  });
});
