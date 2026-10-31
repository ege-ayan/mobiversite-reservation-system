-- Close sales before refunds, record each payment attempt, and match the hot queries.

-- AlterTable
ALTER TABLE `events` ADD COLUMN `sales_closed_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `payment_attempts` (
    `id` CHAR(36) NOT NULL,
    `booking_id` CHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `state` ENUM('PENDING', 'DECLINED', 'APPLIED', 'REFUND_DUE', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_attempts_idempotency_key_key`(`idempotency_key`),
    INDEX `payment_attempts_booking_id_state_idx`(`booking_id`, `state`),
    INDEX `payment_attempts_state_updated_at_idx`(`state`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_attempts` ADD CONSTRAINT `payment_attempts_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The event foreign key needs an index that starts with event_id.
-- Create the replacement before dropping the single-column index.
CREATE INDEX `bookings_event_id_status_expires_at_idx` ON `bookings`(`event_id`, `status`, `expires_at`);

-- CreateIndex
CREATE INDEX `bookings_event_id_created_at_id_idx` ON `bookings`(`event_id`, `created_at`, `id`);

-- DropIndex
DROP INDEX `bookings_user_id_idx` ON `bookings`;

-- DropIndex
DROP INDEX `bookings_event_id_idx` ON `bookings`;

-- The catalog lists events that are still on sale. Both flags lead the index.
DROP INDEX `events_deleted_at_starts_at_id_idx` ON `events`;

-- CreateIndex
CREATE INDEX `events_deleted_at_sales_closed_at_starts_at_id_idx` ON `events`(`deleted_at`, `sales_closed_at`, `starts_at`, `id`);
