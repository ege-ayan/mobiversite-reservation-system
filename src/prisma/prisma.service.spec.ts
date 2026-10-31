import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '@/config/env.validation.js';

import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  it('connects when the module starts and disconnects when it stops', async () => {
    const connect = vi
      .spyOn(PrismaService.prototype, '$connect')
      .mockResolvedValue();
    const disconnect = vi
      .spyOn(PrismaService.prototype, '$disconnect')
      .mockResolvedValue();
    const service = new PrismaService({
      get: () => 'mysql://mobiversite:mobiversite@127.0.0.1:3306/mobiversite',
    } as unknown as ConfigService<EnvironmentVariables, true>);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    connect.mockRestore();
    disconnect.mockRestore();
  });
});
