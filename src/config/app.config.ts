import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import helmet from 'helmet';
import { PrismaExceptionFilter } from '../common/filters/prisma-exception.filter.js';
import { setupOpenApi } from './openapi.config.js';

export function configureApp(app: INestApplication) {
  const http = app.getHttpAdapter().getInstance() as {
    set?: (setting: string, value: unknown) => void;
    use?: (...args: unknown[]) => void;
  };
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'docs', method: RequestMethod.ALL },
      { path: 'docs-json', method: RequestMethod.GET },
      { path: 'docs/*path', method: RequestMethod.ALL },
    ],
  });
  http.set?.('trust proxy', 1);
  http.use?.(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  setupOpenApi(app);
}
