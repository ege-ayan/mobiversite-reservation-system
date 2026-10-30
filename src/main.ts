import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { EnvironmentVariables } from './config/env.validation.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const port = configService.get('PORT', { infer: true });
  await app.listen(port);
}
await bootstrap();
