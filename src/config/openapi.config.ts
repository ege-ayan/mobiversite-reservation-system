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
    .addTag('Webhooks', 'Payment provider callbacks')
    .addBearerAuth({
      type: 'http',
      description: 'Paste an access token if you already have one.',
    })
    .addOAuth2({
      type: 'oauth2',
      description: 'Sign in with the account email and password.',
      flows: {
        password: {
          tokenUrl: '/api/v1/auth/token',
          scopes: {},
        },
      },
    })
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      customCss: `
        .scope-def,
        .auth-container p.flow,
        .auth-container p:has(> code),
        .auth-container .wrapper:has(> label[for='password_type']),
        .auth-container .wrapper:has(> label[for^='client_id']),
        .auth-container .wrapper:has(> label[for^='client_secret']) {
          display: none;
        }
      `,
      customJsStr: `
        (() => {
          const tidy = () => {
            document.querySelectorAll('h4').forEach((heading) => {
              if (!heading.textContent.includes('(OAuth2, password)')) {
                return;
              }
              const jump = heading.querySelector('a, button');
              heading.textContent = 'Email and password';
              if (jump) {
                heading.append(' ');
                heading.append(jump);
              }
            });
            document
              .querySelectorAll('label[for="oauth_username"]')
              .forEach((label) => {
                if (label.textContent !== 'email:') {
                  label.textContent = 'email:';
                }
              });
            document
              .querySelectorAll('#client_id_password, #client_secret_password')
              .forEach((field) => {
                field.required = false;
              });
          };
          tidy();
          new MutationObserver(tidy).observe(document.documentElement, {
            childList: true,
            subtree: true,
          });
        })();
      `,
      swaggerOptions: {
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        persistAuthorization: true,
      },
    },
  );
}
