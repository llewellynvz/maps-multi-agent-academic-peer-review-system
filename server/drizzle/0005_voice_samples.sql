CREATE TABLE `voice_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`blob_path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "voice_samples_sha256_length_check" CHECK(length("voice_samples"."sha256") = 64)
);
--> statement-breakpoint
CREATE INDEX `idx_voice_samples_review` ON `voice_samples` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `voice_samples_review_sha256_unique` ON `voice_samples` (`review_id`,`sha256`);