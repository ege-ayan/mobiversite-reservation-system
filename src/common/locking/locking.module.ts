import { Global, Module } from '@nestjs/common';

import { SweepLock } from './mysql-lock.js';

@Global()
@Module({
  providers: [SweepLock],
  exports: [SweepLock],
})
export class LockingModule {}
