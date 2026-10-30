-- AlterTable
ALTER TABLE `events` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `bookings_user_id_created_at_idx` ON `bookings`(`user_id`, `created_at`);

-- CreateIndex
CREATE INDEX `events_starts_at_idx` ON `events`(`starts_at`);
