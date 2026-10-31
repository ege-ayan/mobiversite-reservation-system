import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '@/auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '@/auth/types/authenticated-user.js';
import { forbidden } from '@/common/errors/app.exception.js';
import type { Role } from '@/generated/prisma/client.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (!user || !roles.includes(user.role)) {
      throw forbidden('Insufficient role', 'INSUFFICIENT_ROLE');
    }
    return true;
  }
}
