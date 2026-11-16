import { Controller, Get, Req } from '@nestjs/common';
import { AuthRequest } from './auth';
import { rows, Row } from './db';
@Controller('companies')
export class CompaniesController {
  @Get() async list(@Req() req: AuthRequest): Promise<Row> {
    const items = await rows(
      `SELECT id,code,name FROM companies ${req.user.public_access ? '' : 'WHERE id=?'} ORDER BY id`,
      req.user.public_access ? [] : [req.user.company_id],
    );
    return { items, total: items.length, page: 1, page_size: items.length };
  }
}
