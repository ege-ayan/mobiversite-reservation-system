import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { EnvironmentVariables } from './env.validation.js';

export function setupOpenApi(app: INestApplication) {
  const port = app
    .get(ConfigService<EnvironmentVariables, true>)
    .get('PORT', { infer: true });
  const config = new DocumentBuilder()
    .setTitle('Mobiversite Reservation API')
    .setDescription('Event ticket reservation API')
    .setVersion('1.0')
    .addServer(`http://localhost:${port}`)
    .addTag('Auth', 'Customer registration and login')
    .addTag('Bookings', 'Ticket reservations')
    .addTag('Events', 'Event catalog and administration')
    .addTag('Health', 'Service health')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      swaggerOptions: {
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    },
  );
}
