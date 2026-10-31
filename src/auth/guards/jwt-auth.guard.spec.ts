import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('JwtAuthGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const context = {
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as unknown as ExecutionContext;

  it('skips authentication on a public route', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const guard = new JwtAuthGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      'handler',
      'class',
    ]);
  });

  it('asks passport to authenticate a protected route', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const parent = vi
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);
    const guard = new JwtAuthGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(context)).toBe(true);
    expect(parent).toHaveBeenCalledWith(context);
    parent.mockRestore();
  });
});
