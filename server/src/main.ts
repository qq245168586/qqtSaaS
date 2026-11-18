import { VoiceController } from './voice';
import { AiRequestError } from './ai-errors';
import 'reflect-metadata';
import { TodosController } from './todos';
import { TodoRecurrenceService } from './todo-recurrence';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Module,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import type { Response } from 'express';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { db, rows } from './db';
import { AuthController, AuthGuard } from './auth';
import { TaskController } from './tasks';
import { EmployeeSchedulesController, EmployeeDepartureController } from './employee-schedules';
import { CatalogController } from './catalog';
import { DeliveryController, SummaryController } from './delivery';
import { ImagesController, AiController } from './external';
import { TemplatesController } from './templates';
import { CompanySuggestionsController } from './company-learning';
import { AssigneeSuggestionsController } from './assignee-learning';
import { UsersController } from './users';
import { ExportController } from './export';
import { TemplateExportController } from './template-export';
import { BackupController } from './backup';
import { json } from 'express';
import { FilesController } from './files';
import { CompaniesController } from './companies';
import { BomController } from './bom';
import { CostingController } from './costing';
import { WikiController, WikiImagesController, WikiDirectoriesController } from './wiki';
@Catch()
class Errors implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    let status = 500;
    let message = '服务暂时不可用';
    if (exception instanceof ZodError) {
      status = 400;
      message = exception.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；');
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      exception.code === 'ER_DUP_ENTRY'
    ) {
      status = 409;
      message = '记录名称或编号已存在';
    } else console.error(exception instanceof Error ? exception.message : 'Internal error');
    res.status(status).json({
      code: status,
      message,
      data: null,
      ...(exception instanceof AiRequestError ? exception.metadata() : {}),
    });
  }
}
@Injectable()
class Envelope implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(map((data: unknown) => ({ code: 0, message: 'ok', data: data ?? null })));
  }
}
@Controller()
class HealthController {
  @Get('health') async get(): Promise<{ status: string }> {
    await rows('SELECT 1');
    return { status: 'ok' };
  }
}
@Module({
  controllers: [
    HealthController,
    VoiceController,
    TodosController,
    AuthController,
    ExportController,
    TemplateExportController,
    BackupController,
    UsersController,
    CompanySuggestionsController,
    AssigneeSuggestionsController,
    TaskController,
    ImagesController,
    FilesController,
    CompaniesController,
    BomController,
    CostingController,
    WikiController,
    WikiDirectoriesController,
    WikiImagesController,
    EmployeeDepartureController,
    EmployeeSchedulesController,
    CatalogController,
    DeliveryController,
    SummaryController,
    AiController,
    TemplatesController,
  ],
  providers: [
    TodoRecurrenceService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: Envelope },
  ],
})
export class AppModule {}
async function bootstrap(): Promise<void> {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32)
    throw new Error('必须配置 >=32 字节 JWT_SECRET');
  await db.initialize();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  app.use(json({ limit: '10mb' }));
  app.use(cookieParser());
  app.useGlobalFilters(new Errors());
  const allowed = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(
    ',',
  );
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => {
      if (!origin || allowed.includes(origin)) callback(null, true);
      else callback(new Error('Origin not allowed'), false);
    },
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
}
if (require.main === module)
  void bootstrap().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
