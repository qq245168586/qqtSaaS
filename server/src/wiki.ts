import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { manager, type AuthRequest } from './auth';
import { db, execute, insert, rows, type Row } from './db';
import { createStorage, type Storage } from './storage';
import {
  parseWikiBlocks,
  wikiBlocksSchema,
  wikiImageIds,
  wikiPlainText,
  type WikiBlock,
} from './wiki-core';

import { wikiDirectoryPath, directoryAncestors } from './wiki-directory';

const idSchema = z.string().regex(/^\d+$/u);
const nullableIdSchema = z.union([idSchema, z.null()]);
const titleSchema = z.string().trim().min(1).max(200);
const iconSchema = z.string().trim().min(1).max(16);
const createSchema = z
  .object({
    parent_id: nullableIdSchema.default(null),
    directory_path: wikiDirectoryPath.default('/'),
    title: titleSchema,
    icon: iconSchema.default('📄'),
    blocks: wikiBlocksSchema,
    position: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
const updateSchema = z
  .object({
    parent_id: nullableIdSchema,
    directory_path: wikiDirectoryPath,
    title: titleSchema,
    icon: iconSchema,
    blocks: wikiBlocksSchema,
    position: z.number().int().min(0).max(1_000_000),
    expected_version: z.number().int().min(1),
    create_version: z.boolean().default(false),
  })
  .strict();

async function wikiStorage(): Promise<Storage> {
  try {
    return await createStorage();
  } catch {
    throw new ServiceUnavailableException('服务器附件目录不可用');
  }
}

async function validateImageBlocks(blocks: WikiBlock[], transaction: EntityManager): Promise<void> {
  const ids = wikiImageIds(blocks);
  if (!ids.length) return;
  const found = await rows(
    `SELECT id FROM wiki_images WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
    ids,
    transaction,
  );
  if (found.length !== ids.length) throw new BadRequestException('页面包含不存在的图片');
}

function pageSummary(row: Row): Row {
  return {
    id: String(row.id),
    parent_id: row.parent_id === null ? null : String(row.parent_id),
    directory_path: String(row.directory_path ?? '/'),
    title: String(row.title),
    icon: String(row.icon),
    position: Number(row.position),
    version: Number(row.version),
    updated_at: String(row.updated_at),
    updated_by_name: String(row.updated_by_name ?? ''),
  };
}

function pageDetail(row: Row): Row {
  return { ...pageSummary(row), blocks: parseWikiBlocks(row.content_json) };
}

async function activePage(id: string, transaction?: EntityManager): Promise<Row> {
  const [page] = await rows(
    `SELECT p.*,u.real_name updated_by_name
       FROM wiki_pages p LEFT JOIN users u ON u.id=p.updated_by
      WHERE p.id=? AND p.deleted_at IS NULL`,
    [id],
    transaction,
  );
  if (!page) throw new NotFoundException('页面不存在或已删除');
  return page;
}

async function validateParent(
  pageId: string | null,
  parentId: string | null,
  transaction: EntityManager,
): Promise<void> {
  if (parentId === null) return;
  if (pageId === parentId) throw new BadRequestException('页面不能成为自己的上级页面');
  let current: string | null = parentId;
  for (let depth = 0; depth < 100 && current !== null; depth += 1) {
    const [parent] = await rows(
      'SELECT id,parent_id FROM wiki_pages WHERE id=? AND deleted_at IS NULL',
      [current],
      transaction,
    );
    if (!parent) throw new BadRequestException('上级页面不存在');
    if (pageId !== null && String(parent.id) === pageId)
      throw new BadRequestException('不能把页面移动到自己的子页面下');
    current = parent.parent_id === null ? null : String(parent.parent_id);
  }
  if (current !== null) throw new BadRequestException('页面层级过深');
}

async function addVersion(
  pageId: string,
  version: number,
  title: string,
  icon: string,
  blocks: WikiBlock[],
  userId: string,
  transaction: EntityManager,
): Promise<void> {
  await insert(
    'wiki_page_versions',
    {
      page_id: pageId,
      version,
      title,
      icon,
      content_json: JSON.stringify(blocks),
      content_text: wikiPlainText(blocks),
      created_by: userId,
    },
    transaction,
  );
}

@Controller('wiki/pages')
export class WikiController {
  @Get() async list(@Req() req: AuthRequest, @Query('keyword') rawKeyword?: unknown): Promise<Row> {
    manager(req.user);
    const keyword = z
      .string()
      .trim()
      .max(100)
      .catch('')
      .parse(rawKeyword ?? '');
    const parameters: unknown[] = [];
    let filter = 'p.deleted_at IS NULL';
    if (keyword) {
      filter += ' AND (p.title LIKE ? OR p.content_text LIKE ?)';
      parameters.push(`%${keyword}%`, `%${keyword}%`);
    }
    const items = await rows(
      `SELECT p.id,p.parent_id,p.directory_path,p.title,p.icon,p.position,p.version,p.updated_at,u.real_name updated_by_name
         FROM wiki_pages p LEFT JOIN users u ON u.id=p.updated_by
        WHERE ${filter}
        ORDER BY p.parent_id IS NOT NULL,p.parent_id,p.position,p.id`,
      parameters,
    );
    return { items: items.map(pageSummary), total: items.length };
  }

  @Get(':id') async get(@Req() req: AuthRequest, @Param('id') rawId: string): Promise<Row> {
    manager(req.user);
    return pageDetail(await activePage(idSchema.parse(rawId)));
  }

  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    manager(req.user);
    const input = createSchema.parse(body);
    return db.transaction(async (transaction) => {
      await validateParent(null, input.parent_id, transaction);
      await validateDirectory(input.directory_path, transaction);
      await validateImageBlocks(input.blocks, transaction);
      const pageId = await insert(
        'wiki_pages',
        {
          parent_id: input.parent_id,
          directory_path: input.directory_path,
          title: input.title,
          icon: input.icon,
          content_json: JSON.stringify(input.blocks),
          content_text: wikiPlainText(input.blocks),
          position: input.position,
          version: 1,
          created_by: req.user.id,
          updated_by: req.user.id,
        },
        transaction,
      );
      await addVersion(pageId, 1, input.title, input.icon, input.blocks, req.user.id, transaction);
      return pageDetail(await activePage(pageId, transaction));
    });
  }

  @Put(':id') async update(
    @Req() req: AuthRequest,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    const id = idSchema.parse(rawId);
    const input = updateSchema.parse(body);
    return db.transaction(async (transaction) => {
      await rows(
        'SELECT id FROM wiki_pages WHERE id=? AND deleted_at IS NULL FOR UPDATE',
        [id],
        transaction,
      );
      const page = await activePage(id, transaction);
      if (Number(page.version) !== input.expected_version)
        throw new ConflictException('页面已被其他人修改，请刷新后再编辑');
      await validateParent(id, input.parent_id, transaction);
      const directoryPath = input.directory_path;
      await validateDirectory(directoryPath, transaction);
      await validateImageBlocks(input.blocks, transaction);
      const nextVersion = input.expected_version + 1;
      await execute(
        `UPDATE wiki_pages
            SET parent_id=?,directory_path=?,title=?,icon=?,content_json=?,content_text=?,position=?,version=?,updated_by=?
          WHERE id=? AND deleted_at IS NULL AND version=?`,
        [
          input.parent_id,
          directoryPath,
          input.title,
          input.icon,
          JSON.stringify(input.blocks),
          wikiPlainText(input.blocks),
          input.position,
          nextVersion,
          req.user.id,
          id,
          input.expected_version,
        ],
        transaction,
      );
      if (input.create_version)
        await addVersion(
          id,
          nextVersion,
          input.title,
          input.icon,
          input.blocks,
          req.user.id,
          transaction,
        );
      return pageDetail(await activePage(id, transaction));
    });
  }

  @Get(':id/versions') async versions(
    @Req() req: AuthRequest,
    @Param('id') rawId: string,
  ): Promise<Row> {
    manager(req.user);
    const id = idSchema.parse(rawId);
    await activePage(id);
    const items = await rows(
      `SELECT v.id,v.page_id,v.version,v.title,v.icon,v.created_at,u.real_name created_by_name
         FROM wiki_page_versions v LEFT JOIN users u ON u.id=v.created_by
        WHERE v.page_id=? ORDER BY v.version DESC,v.id DESC`,
      [id],
    );
    return {
      items: items.map((item) => ({
        id: String(item.id),
        page_id: String(item.page_id),
        version: Number(item.version),
        title: String(item.title),
        icon: String(item.icon),
        created_at: String(item.created_at),
        created_by_name: String(item.created_by_name ?? ''),
      })),
      total: items.length,
    };
  }

  @Post(':id/versions/:versionId/restore') async restore(
    @Req() req: AuthRequest,
    @Param('id') rawId: string,
    @Param('versionId') rawVersionId: string,
  ): Promise<Row> {
    manager(req.user);
    const id = idSchema.parse(rawId);
    const versionId = idSchema.parse(rawVersionId);
    return db.transaction(async (transaction) => {
      await rows(
        'SELECT id FROM wiki_pages WHERE id=? AND deleted_at IS NULL FOR UPDATE',
        [id],
        transaction,
      );
      const page = await activePage(id, transaction);
      const [snapshot] = await rows(
        'SELECT * FROM wiki_page_versions WHERE id=? AND page_id=?',
        [versionId, id],
        transaction,
      );
      if (!snapshot) throw new NotFoundException('历史版本不存在');
      const blocks = parseWikiBlocks(snapshot.content_json);
      await validateImageBlocks(blocks, transaction);
      const nextVersion = Number(page.version) + 1;
      await execute(
        `UPDATE wiki_pages SET title=?,icon=?,content_json=?,content_text=?,version=?,updated_by=?
          WHERE id=? AND deleted_at IS NULL`,
        [
          snapshot.title,
          snapshot.icon,
          JSON.stringify(blocks),
          snapshot.content_text,
          nextVersion,
          req.user.id,
          id,
        ],
        transaction,
      );
      await addVersion(
        id,
        nextVersion,
        String(snapshot.title),
        String(snapshot.icon),
        blocks,
        req.user.id,
        transaction,
      );
      return pageDetail(await activePage(id, transaction));
    });
  }

  @Delete(':id') async remove(@Req() req: AuthRequest, @Param('id') rawId: string): Promise<null> {
    manager(req.user);
    const id = idSchema.parse(rawId);
    await activePage(id);
    const [child] = await rows(
      'SELECT id FROM wiki_pages WHERE parent_id=? AND deleted_at IS NULL LIMIT 1',
      [id],
    );
    if (child) throw new BadRequestException('请先移动或删除此页面下的子页面');
    await execute('UPDATE wiki_pages SET deleted_at=NOW(),updated_by=? WHERE id=?', [
      req.user.id,
      id,
    ]);
    return null;
  }
}

@Controller('wiki/images')
export class WikiImagesController {
  @Get(':id') async get(@Req() req: AuthRequest, @Param('id') rawId: string): Promise<Row> {
    manager(req.user);
    const id = idSchema.parse(rawId);
    const [image] = await rows('SELECT * FROM wiki_images WHERE id=? AND deleted_at IS NULL', [id]);
    if (!image) throw new NotFoundException('图片不存在');
    const client = await wikiStorage();
    return {
      id: String(image.id),
      file_name: String(image.file_name),
      url: client.signatureUrl(String(image.oss_key)),
    };
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async upload(@Req() req: AuthRequest, @UploadedFile() file?: Express.Multer.File): Promise<Row> {
    manager(req.user);
    if (!file) throw new BadRequestException('请选择图片');
    let png: Buffer;
    try {
      const metadata = await sharp(file.buffer, {
        limitInputPixels: 24000000,
        animated: false,
      }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
        throw new Error('format');
      png = await sharp(file.buffer, { limitInputPixels: 24000000 }).rotate().png().toBuffer();
    } catch {
      throw new BadRequestException('图片必须为 PNG/JPEG/WebP 且不超过 2400 万像素');
    }
    if (png.length > 10 * 1024 * 1024) throw new BadRequestException('转换后图片超过 10 MiB');
    const client = await wikiStorage();
    const key = `wiki/${randomUUID()}.png`;
    let uploaded = false;
    try {
      uploaded = (await client.put(key, png)).created;
      const imageId = await insert('wiki_images', {
        oss_key: key,
        file_name: file.originalname.slice(0, 255) || 'image.png',
        file_size: png.length,
        mime_type: 'image/png',
        created_by: req.user.id,
      });
      return {
        id: imageId,
        file_name: file.originalname.slice(0, 255) || 'image.png',
        url: client.signatureUrl(key),
      };
    } catch (error: unknown) {
      if (uploaded) await client.delete(key).catch(() => undefined);
      throw error;
    }
  }
}

async function validateDirectory(path: string, transaction: EntityManager): Promise<void> {
  if (path === '/') return;
  const found = await rows('SELECT id FROM wiki_directories WHERE path=?', [path], transaction);
  if (!found.length) throw new BadRequestException('目录不存在，请先新建目录或重新选择');
}

@Controller('wiki/directories')
export class WikiDirectoriesController {
  @Get() async list(@Req() req: AuthRequest): Promise<Row> {
    manager(req.user);
    const items = await rows('SELECT id,path FROM wiki_directories ORDER BY path,id');
    return {
      items: items.map((item) => ({ id: String(item.id), path: String(item.path) })),
      total: items.length,
    };
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    manager(req.user);
    const { path } = z.object({ path: wikiDirectoryPath }).strict().parse(body);
    if (path === '/') throw new BadRequestException('请输入目录名称');
    return db.transaction(async (transaction) => {
      for (const ancestor of directoryAncestors(path)) {
        await execute(
          'INSERT INTO wiki_directories (path) VALUES (?) ON DUPLICATE KEY UPDATE path=VALUES(path)',
          [ancestor],
          transaction,
        );
      }
      const [item] = await rows(
        'SELECT id,path FROM wiki_directories WHERE path=?',
        [path],
        transaction,
      );
      return { id: String(item.id), path: String(item.path) };
    });
  }
}
