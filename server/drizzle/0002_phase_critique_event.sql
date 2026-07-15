DROP TRIGGER `review_events_no_update`;--> statement-breakpoint
DROP TRIGGER `review_events_no_delete`;--> statement-breakpoint
ALTER TABLE `review_events` RENAME TO `review_events_old`;--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`seq` integer NOT NULL,
	`ts` text NOT NULL,
	`kind` text NOT NULL,
	`phase` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`egress_target` text,
	`egress_query` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_events_kind_check" CHECK("review_events"."kind" in ('phase_transition','gate_verdict','arbitration','web_query','control_ack','deliverable_released','finding_recorded','run_terminal','phase_critique','error')),
	CONSTRAINT "review_events_egress_target_check" CHECK("review_events"."egress_target" in ('crossref','openalex','semantic_scholar'))
);--> statement-breakpoint
INSERT INTO `review_events` (`id`, `review_id`, `seq`, `ts`, `kind`, `phase`, `payload_json`, `egress_target`, `egress_query`) SELECT `id`, `review_id`, `seq`, `ts`, `kind`, `phase`, `payload_json`, `egress_target`, `egress_query` FROM `review_events_old`;--> statement-breakpoint
DROP TABLE `review_events_old`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_review_seq` ON `review_events` (`review_id`,`seq`);--> statement-breakpoint
CREATE TRIGGER review_events_no_update
BEFORE UPDATE ON review_events
BEGIN
  SELECT RAISE(ABORT, 'review_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER review_events_no_delete
BEFORE DELETE ON review_events
WHEN (SELECT count(*) FROM pragma_table_list WHERE schema = 'temp' AND name = '_mara_purge') = 0
BEGIN
  SELECT RAISE(ABORT, 'review_events is append-only');
END;
