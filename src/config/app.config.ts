import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

import { AppExceptionFilter } from '@/common/filters/prisma-exception.filter.js';

import type { EnvironmentVariables } from './env.validation.js';
import { setupOpenApi } from './openapi.config.js';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const http = app.getHttpAdapter().getInstance() as {
    set?: (setting: string, value: unknown) => void;
    use?: (...args: unknown[]) => void;
  };
  const swaggerEnabled = config.get('SWAGGER_ENABLED', { infer: true });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      ...(swaggerEnabled
        ? [
            { path: 'docs', method: RequestMethod.ALL },
            { path: 'docs-json', method: RequestMethod.GET },
            { path: 'docs/*path', method: RequestMethod.ALL },
          ]
        : []),
    ],
  });
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy > 0) {
    http.set?.('trust proxy', trustProxy);
  }
  http.use?.(
    helmet(
      swaggerEnabled
        ? { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }
        : { crossOriginEmbedderPolicy: false },
    ),
  );
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  if (swaggerEnabled) {
    setupOpenApi(app);
  }
}
