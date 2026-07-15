CREATE TABLE `merge_markers` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`marker` text NOT NULL,
	`merged_ids_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merge_markers_review_marker_unique` ON `merge_markers` (`review_id`,`marker`);