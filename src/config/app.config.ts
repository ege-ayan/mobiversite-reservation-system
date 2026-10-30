import { INestApplication, ValidationPipe } from '@nestjs/common';
import { setupOpenApi } from './openapi.config.js';

export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  setupOpenApi(app);
}
