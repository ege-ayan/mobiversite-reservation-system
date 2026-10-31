-- AlterTable
ALTER TABLE `bookings` ADD COLUMN `idempotency_key` VARCHAR(255) NULL,
    ADD COLUMN `request_hash` CHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `bookings_user_id_idempotency_key_key` ON `bookings`(`user_id`, `idempotency_key`);

-- Checks stay outside schema.prisma. Prisma Migrate does not model MySQL CHECK constraints.
ALTER TABLE `events`
  ADD CONSTRAINT `events_available_tickets_check`
  CHECK (`available_tickets` >= 0 AND `available_tickets` <= `total_tickets`);

ALTER TABLE `bookings`
  ADD CONSTRAINT `bookings_quantity_check`
  CHECK (`quantity` >= 1);
