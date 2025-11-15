import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Notebook } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotebookDto, UpdateNotebookDto } from './dto/notebook.dto';

export interface NotebookView {
  id: string;
  name: string;
  parentId: string | null;
  noteCount: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NotebooksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<NotebookView[]> {
    const notebooks = await this.prisma.notebook.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { notes: true } } },
    });
    return notebooks.map(({ _count, userId: _userId, ...notebook }) => ({ ...notebook, noteCount: _count.notes }));
  }

  async create(userId: string, dto: CreateNotebookDto): Promise<NotebookView> {
    const parentId = dto.parentId ?? null;
    if (parentId) {
      await this.assertCanBeParent(userId, parentId);
    }
    await this.assertNameFree(userId, parentId, dto.name);
    const { userId: _userId, ...notebook } = await this.prisma.notebook.create({
      data: { userId, name: dto.name, parentId },
    });
    return { ...notebook, noteCount: 0 };
  }

  async update(userId: string, id: string, dto: UpdateNotebookDto): Promise<NotebookView> {
    const notebook = await this.findOwned(userId, id);
    const parentId = dto.parentId === undefined ? notebook.parentId : dto.parentId;

    if (parentId !== notebook.parentId && parentId !== null) {
      if (parentId === notebook.id) {
        throw new BadRequestException('A notebook cannot be nested inside itself');
      }
      await this.assertCanBeParent(userId, parentId);
      const childCount = await this.prisma.notebook.count({ where: { parentId: notebook.id } });
      if (childCount > 0) {
        throw new BadRequestException('A notebook that has notebooks inside it cannot be nested');
      }
    }

    const name = dto.name ?? notebook.name;
    if (name !== notebook.name || parentId !== notebook.parentId) {
      await this.assertNameFree(userId, parentId, name);
    }

    await this.prisma.notebook.update({ where: { id }, data: { name, parentId } });
    return this.view(userId, id);
  }

  /**
   * Deletes the notebook and the notebooks inside it. Their notes stay, outside
   * any notebook.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.notebook.delete({ where: { id } });
  }

  async findOwned(userId: string, id: string): Promise<Notebook> {
    const notebook = await this.prisma.notebook.findFirst({ where: { id, userId } });
    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }
    return notebook;
  }

  private async view(userId: string, id: string): Promise<NotebookView> {
    const notebook = await this.prisma.notebook.findFirstOrThrow({
      where: { id, userId },
      include: { _count: { select: { notes: true } } },
    });
    const { _count, userId: _userId, ...rest } = notebook;
    return { ...rest, noteCount: _count.notes };
  }

  private async assertCanBeParent(userId: string, parentId: string): Promise<void> {
    const parent = await this.prisma.notebook.findFirst({ where: { id: parentId, userId } });
    if (!parent) {
      throw new NotFoundException('Parent notebook not found');
    }
    if (parent.parentId) {
      throw new BadRequestException('Notebooks can only be nested one level deep');
    }
  }

  private async assertNameFree(userId: string, parentId: string | null, name: string, exceptId?: string) {
    const clash = await this.prisma.notebook.findFirst({
      where: {
        userId,
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictException(`There is already a notebook called "${clash.name}" here`);
    }
  }
}
