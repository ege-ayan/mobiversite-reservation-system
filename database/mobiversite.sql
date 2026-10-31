-- Mobiversite reservation schema and seed data.
-- Import into an empty MySQL 8 database. The API also applies prisma/migrations on startup;
-- the _prisma_migrations rows below make that a no-op after this import.
-- Admin: admin@mobiversite.local / change-me-admin

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('CUSTOMER','ADMIN') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CUSTOMER',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `events`;
CREATE TABLE `events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `venue` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `starts_at` datetime(3) NOT NULL,
  `ticket_price` decimal(10,2) NOT NULL,
  `total_tickets` int NOT NULL,
  `available_tickets` int NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `events_deleted_at_starts_at_id_idx` (`deleted_at`,`starts_at`,`id`),
  CONSTRAINT `events_available_tickets_check` CHECK (((`available_tickets` >= 0) and (`available_tickets` <= `total_tickets`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `bookings`;
CREATE TABLE `bookings` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int NOT NULL,
  `status` enum('HELD','PAID','CANCELLED','EXPIRED','REFUNDED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'HELD',
  `ticket_price` decimal(10,2) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL,
  `idempotency_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bookings_user_id_idempotency_key_key` (`user_id`,`idempotency_key`),
  KEY `bookings_user_id_idx` (`user_id`),
  KEY `bookings_event_id_idx` (`event_id`),
  KEY `bookings_status_expires_at_idx` (`status`,`expires_at`),
  KEY `bookings_user_id_created_at_idx` (`user_id`,`created_at`),
  CONSTRAINT `bookings_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bookings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bookings_quantity_check` CHECK ((`quantity` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `_prisma_migrations`;
CREATE TABLE `_prisma_migrations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checksum` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `migration_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `logs` text COLLATE utf8mb4_unicode_ci,
  `rolled_back_at` datetime(3) DEFAULT NULL,
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `applied_steps_count` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) VALUES ('a910d75c-87a6-4f8b-90d6-138a827f1957', 'f198e0f6600e723bb6f89aeea5151719c2ff4177822d32bf0331894b4405dc5c', '2026-10-30 15:57:28.000', '20261030185727_create_users', NULL, NULL, '2026-10-30 15:57:27.992', '1');
INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) VALUES ('ce44d1f8-72c5-4267-8d97-f46eb01b6272', 'b28807bd2d88a929ec84ee7da03a7c8df06bc113fa92004f20fe47b21a9a13ec', '2026-10-30 16:21:01.319', '20261030192101_add_events_and_bookings', NULL, NULL, '2026-10-30 16:21:01.256', '1');
INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) VALUES ('6f768386-fc34-4598-9fe2-2590778d2727', '86ea4f916637f1847efccd9a98fd0fc9dd4ed454a85bc87c1e5887e0cf256593', '2026-10-30 17:01:19.046', '20261030200119_soft_delete_events', NULL, NULL, '2026-10-30 17:01:19.021', '1');
INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) VALUES ('f12281bf-1744-4439-a83f-b3e3a9aa1436', 'c59df3b4ef449d7c8568521f3517aa7046f41968c8cdab1baf6cba397847c073', '2026-10-30 18:22:21.360', '20261031001500_booking_idempotency_and_checks', NULL, NULL, '2026-10-30 18:22:21.028', '1');
INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) VALUES ('36a1dbc8-8260-41af-ac2e-dbafdb52c0e7', 'a87549c4dd9f806ce51daf1c2a1de79d088b7552ec9ea300471919910680ccf1', '2026-10-31 06:25:32.731', '20261031120300_refunds_and_catalog_index', NULL, NULL, '2026-10-31 06:25:32.691', '1');

INSERT INTO `users` (`id`, `email`, `password_hash`, `role`, `created_at`, `updated_at`) VALUES (
  '00000000-0000-7000-8000-000000000001',
  'admin@mobiversite.local',
  '$2b$12$7HGeUFUaji139a5lH.wA/OH5Tg/u6Y7e0YN67qoAUEJ4QErGLRhS.',
  'ADMIN',
  '2026-10-31 09:00:00.000',
  '2026-10-31 09:00:00.000'
);

INSERT INTO `events` (`id`, `title`, `description`, `venue`, `starts_at`, `ticket_price`, `total_tickets`, `available_tickets`, `created_at`, `updated_at`, `deleted_at`) VALUES (
  '00000000-0000-7000-8000-000000000002',
  'Mobiversite Live',
  'An evening of talks and music.',
  'Kadikoy',
  '2027-06-01 18:00:00.000',
  25.00,
  100,
  100,
  '2026-10-31 09:00:00.000',
  '2026-10-31 09:00:00.000',
  NULL
);

SET FOREIGN_KEY_CHECKS = 1;
