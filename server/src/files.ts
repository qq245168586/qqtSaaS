import { Controller, Get, Query, Res, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import { createStorage } from './storage';
@Controller('files')
export class FilesController {
  @Get('image') async image(
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const storage = await createStorage();
    const input = z
      .object({
        key: z.string(),
        variant: z.enum(['original', 'thumbnail']),
        expires: z.coerce.number().int(),
        signature: z.string(),
      })
      .strict()
      .safeParse(query);
    if (!input.success) throw new ForbiddenException('附件签名无效');
    const v = input.data;
    try {
      storage.verify(v.key, v.variant, v.expires, v.signature);
    } catch {
      throw new ForbiddenException('附件签名无效或已过期');
    }
    let data: Buffer;
    try {
      data = await storage.read(v.key);
    } catch {
      throw new NotFoundException('附件不存在');
    }
    if (v.variant === 'thumbnail')
      data = await sharp(data, { limitInputPixels: 24000000 })
        .resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Cache-Control',
      `private, max-age=${Math.max(0, Math.min(60, v.expires - Math.floor(Date.now() / 1000)))}`,
    );
    res.send(data);
  }
}
