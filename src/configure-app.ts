import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { EnvironmentVariables } from './config/env.validation.js';

export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = app
    .get(ConfigService<EnvironmentVariables, true>)
    .get('PORT', { infer: true });
  const config = new DocumentBuilder()
    .setTitle('Mobiversite Reservation API')
    .setDescription('Event ticket reservation API')
    .setVersion('1.0')
    .addServer(`http://localhost:${port}`)
    .addTag('Auth', 'Customer registration and login')
    .addBearerAuth()
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory, {
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
