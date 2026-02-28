import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { hashPassword } from '../auth/password';
import { APP_CONFIG, AppConfig } from '../config/config';
import { extractWikiLinks, normalizeTitle } from '../links/wikilinks';
import { PrismaService } from '../prisma/prisma.service';
import { newShareToken } from '../shares/shares.service';
import { DEMO_NOTEBOOKS, DEMO_NOTES } from './demo-data';

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'demo-password';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Creates the demo account with sample notes on start-up when SEED_DEMO is on. */
@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.seedDemo) return;
    const created = await this.seed();
    if (created) {
      this.logger.log(`Created the demo account ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    }
  }

  /** Returns false when the demo account already exists. */
  async seed(now = new Date()): Promise<boolean> {
    if (await this.prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
      return false;
    }
    const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email: DEMO_EMAIL, name: 'Demo User', passwordHash, createdAt: daysAgo(340) },
        });

        const notebookIds = new Map<string, string>();
        for (const notebook of DEMO_NOTEBOOKS) {
          const parent = await tx.notebook.create({
            data: { userId: user.id, name: notebook.name, createdAt: daysAgo(330) },
          });
          notebookIds.set(notebook.name, parent.id);
          for (const child of notebook.children ?? []) {
            const created = await tx.notebook.create({
              data: { userId: user.id, name: child, parentId: parent.id, createdAt: daysAgo(300) },
            });
            notebookIds.set(`${notebook.name}/${child}`, created.id);
          }
        }

        const tagIds = new Map<string, string>();
        for (const name of new Set(DEMO_NOTES.flatMap((note) => note.tags ?? []))) {
          const tag = await tx.tag.create({ data: { userId: user.id, name } });
          tagIds.set(name, tag.id);
        }

        for (const demo of DEMO_NOTES) {
          const updatedAt = daysAgo(demo.updatedDaysAgo);
          const note = await tx.note.create({
            data: {
              userId: user.id,
              notebookId: demo.notebook.length ? (notebookIds.get(demo.notebook.join('/')) ?? null) : null,
              title: demo.title,
              content: demo.content,
              pinned: demo.pinned ?? false,
              favorite: demo.favorite ?? false,
              createdAt: daysAgo(demo.createdDaysAgo),
              updatedAt,
              deletedAt: demo.trashedDaysAgo === undefined ? null : daysAgo(demo.trashedDaysAgo),
            },
          });

          const tags = (demo.tags ?? []).map((name) => ({ noteId: note.id, tagId: tagIds.get(name) as string }));
          if (tags.length) await tx.noteTag.createMany({ data: tags });

          const links = extractWikiLinks(demo.content);
          if (links.length) {
            await tx.noteLink.createMany({
              data: links.map((link) => ({
                sourceId: note.id,
                targetTitle: link.title,
                targetKey: normalizeTitle(link.title),
              })),
            });
          }

          for (const version of demo.versions ?? []) {
            await tx.noteVersion.create({
              data: {
                noteId: note.id,
                title: version.title ?? demo.title,
                content: version.content,
                createdAt: new Date(updatedAt.getTime() - version.daysEarlier * DAY_MS),
              },
            });
          }

          if (demo.shared) {
            await tx.shareLink.create({
              data: {
                noteId: note.id,
                token: newShareToken(),
                viewCount: demo.shared.views,
                createdAt: daysAgo(Math.max(demo.updatedDaysAgo, 1)),
              },
            });
          }
        }
      },
      { timeout: 30_000 },
    );
    return true;
  }
}
