-- AlterTable
ALTER TABLE `bookings`
  MODIFY `status` ENUM('HELD', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'HELD';

-- The catalog lists visible events by start time. The leading deleted_at
-- column keeps that filter from scanning hidden rows.
DROP INDEX `events_starts_at_idx` ON `events`;

-- CreateIndex
CREATE INDEX `events_deleted_at_starts_at_id_idx` ON `events`(`deleted_at`, `starts_at`, `id`);
