import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { SweepLock, SWEEP_LOCK_NAME } from '../common/locking/mysql-lock.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const EXPIRY_EVENT_BATCH = 200;

@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly sweepLock: SweepLock,
  ) {}

  async releaseExpiredHolds(now = new Date()): Promise<number> {
    const released = await this.sweepLock.tryWithLock(
      SWEEP_LOCK_NAME,
      async () => {
        const eventIds = await this.expiredEventIds(now);
        let count = 0;
        for (const eventId of eventIds) {
          try {
            count += await this.inventory.reclaim(eventId, now);
          } catch (error) {
            if (error instanceof NotFoundException) {
              continue;
            }
            this.logger.error(
              `Failed to expire holds for event ${eventId}`,
              error instanceof Error ? error.stack : undefined,
            );
          }
        }
        return count;
      },
    );
    return released ?? 0;
  }

  private async expiredEventIds(now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, string>>>(
      Prisma.sql`
        SELECT DISTINCT bookings.event_id AS eventId
        FROM bookings
        INNER JOIN events ON events.id = bookings.event_id
        WHERE bookings.status = 'HELD'
          AND (bookings.expires_at <= ${now} OR events.starts_at <= ${now})
        LIMIT ${Prisma.raw(String(EXPIRY_EVENT_BATCH))}
      `,
    );
    return rows.flatMap((row) => {
      // The MariaDB driver may return the alias in either case.
      const eventId = row.eventId ?? row.eventid;
      return eventId ? [eventId] : [];
    });
  }
}
