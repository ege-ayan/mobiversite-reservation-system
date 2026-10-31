-- Mobiversite reservation schema and seed data.
-- Import into an empty MySQL 8 database. Compose applies prisma/migrations in the
-- migrate service before the API starts. The _prisma_migrations rows below make
-- that a no-op after this import.
-- Admin: admin@mobiversite.local / change-me-admin


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `_prisma_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `_prisma_migrations` DISABLE KEYS */;
INSERT INTO `_prisma_migrations` VALUES ('3b228b3e-0565-4d2b-9aca-9be381efd7ff','6c3fe8c8e9a314aff383768186d5f892589264d8941ba0ad55cfb14a1faa5b88','2026-10-31 12:42:07.208','20261031160000_audit_refresh_and_search',NULL,NULL,'2026-10-31 12:42:07.121',1),('3cb15a18-e26b-4749-aed2-52b8b8d1347b','f198e0f6600e723bb6f89aeea5151719c2ff4177822d32bf0331894b4405dc5c','2026-10-31 12:42:06.908','20261030185727_create_users',NULL,NULL,'2026-10-31 12:42:06.893',1),('57b33d55-7135-4a90-aa05-6ae4c14555fe','c59df3b4ef449d7c8568521f3517aa7046f41968c8cdab1baf6cba397847c073','2026-10-31 12:42:07.039','20261031001500_booking_idempotency_and_checks',NULL,NULL,'2026-10-31 12:42:06.986',1),('5a93178d-0ded-4816-a518-602461de1a23','86ea4f916637f1847efccd9a98fd0fc9dd4ed454a85bc87c1e5887e0cf256593','2026-10-31 12:42:06.986','20261030200119_soft_delete_events',NULL,NULL,'2026-10-31 12:42:06.959',1),('7c69d542-ad40-44f8-a051-1c533fc2454f','00aad5b7a72d916f5f20fdee3d47a27fd869ffde43c8ca5e2598302d5b01a406','2026-10-31 12:42:07.121','20261031140000_sales_window_and_payment_attempts',NULL,NULL,'2026-10-31 12:42:07.055',1),('addd75a9-2aa3-4b05-aa7a-5f6bc31a7349','a87549c4dd9f806ce51daf1c2a1de79d088b7552ec9ea300471919910680ccf1','2026-10-31 12:42:07.054','20261031120300_refunds_and_catalog_index',NULL,NULL,'2026-10-31 12:42:07.040',1),('c95c0c42-3dab-436b-899c-47e84c5d04d8','b28807bd2d88a929ec84ee7da03a7c8df06bc113fa92004f20fe47b21a9a13ec','2026-10-31 12:42:06.958','20261030192101_add_events_and_bookings',NULL,NULL,'2026-10-31 12:42:06.909',1);
/*!40000 ALTER TABLE `_prisma_migrations` ENABLE KEYS */;
DROP TABLE IF EXISTS `booking_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `booking_events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `booking_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_status` enum('HELD','PAID','CANCELLED','EXPIRED','REFUNDED') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_status` enum('HELD','PAID','CANCELLED','EXPIRED','REFUNDED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `booking_events_booking_id_created_at_idx` (`booking_id`,`created_at`),
  CONSTRAINT `booking_events_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `booking_events` DISABLE KEYS */;
/*!40000 ALTER TABLE `booking_events` ENABLE KEYS */;
DROP TABLE IF EXISTS `bookings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `paid_at` datetime(3) DEFAULT NULL,
  `cancelled_at` datetime(3) DEFAULT NULL,
  `refunded_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bookings_user_id_idempotency_key_key` (`user_id`,`idempotency_key`),
  KEY `bookings_status_expires_at_idx` (`status`,`expires_at`),
  KEY `bookings_user_id_created_at_idx` (`user_id`,`created_at`),
  KEY `bookings_event_id_status_expires_at_idx` (`event_id`,`status`,`expires_at`),
  KEY `bookings_event_id_created_at_id_idx` (`event_id`,`created_at`,`id`),
  CONSTRAINT `bookings_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bookings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bookings_quantity_check` CHECK ((`quantity` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
/*!40000 ALTER TABLE `bookings` ENABLE KEYS */;
DROP TABLE IF EXISTS `events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `sales_closed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `events_deleted_at_sales_closed_at_starts_at_id_idx` (`deleted_at`,`sales_closed_at`,`starts_at`,`id`),
  FULLTEXT KEY `events_title_idx` (`title`),
  CONSTRAINT `events_available_tickets_check` CHECK (((`available_tickets` >= 0) and (`available_tickets` <= `total_tickets`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `events` DISABLE KEYS */;
INSERT INTO `events` VALUES ('00000000-0000-7000-8000-000000000002','Mobiversite Live','An evening of talks and music.','Kadikoy','2027-06-01 18:00:00.000',25.00,100,100,'2026-10-31 12:42:07.605','2026-10-31 12:42:07.605',NULL,NULL);
/*!40000 ALTER TABLE `events` ENABLE KEYS */;
DROP TABLE IF EXISTS `payment_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_attempts` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `booking_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `idempotency_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `state` enum('PENDING','DECLINED','APPLIED','REFUND_DUE','REFUNDED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `payment_attempts_idempotency_key_key` (`idempotency_key`),
  KEY `payment_attempts_booking_id_state_idx` (`booking_id`,`state`),
  KEY `payment_attempts_state_updated_at_idx` (`state`,`updated_at`),
  CONSTRAINT `payment_attempts_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `payment_attempts` DISABLE KEYS */;
/*!40000 ALTER TABLE `payment_attempts` ENABLE KEYS */;
DROP TABLE IF EXISTS `refresh_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `refresh_tokens` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `refresh_tokens_token_hash_key` (`token_hash`),
  KEY `refresh_tokens_user_id_revoked_at_idx` (`user_id`,`revoked_at`),
  CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `refresh_tokens` DISABLE KEYS */;
/*!40000 ALTER TABLE `refresh_tokens` ENABLE KEYS */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES ('00000000-0000-7000-8000-000000000001','admin@mobiversite.local','$2b$12$lPW8g5YxODrf0NuvpwOabeyJB0ZuBhx.EempuPrH4r5i6hgyDVQxq','ADMIN','2026-10-31 12:42:07.594','2026-10-31 12:42:07.594');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

