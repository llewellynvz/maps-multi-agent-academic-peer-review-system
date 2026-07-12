CREATE TABLE `deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`kind` text NOT NULL,
	`format` text NOT NULL,
	`path` text NOT NULL,
	`checksum` text NOT NULL,
	`byte_size` integer NOT NULL,
	`released` integer DEFAULT 0 NOT NULL,
	`released_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deliverables_kind_check" CHECK("deliverables"."kind" in ('peer_review_report','reviewer_private_notes','ledger_export','run_archive')),
	CONSTRAINT "deliverables_format_check" CHECK("deliverables"."format" in ('docx','md','zip')),
	CONSTRAINT "deliverables_checksum_length_check" CHECK(length("deliverables"."checksum") = 64)
);
--> statement-breakpoint
CREATE INDEX `idx_deliverables_review` ON `deliverables` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deliverables_review_kind_format_unique` ON `deliverables` (`review_id`,`kind`,`format`);--> statement-breakpoint
CREATE TABLE `dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`phase` text NOT NULL,
	`agent` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`tokens_cached` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error_class` text,
	`langfuse_trace_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dispatches_provider_check" CHECK("dispatches"."provider" in ('anthropic','openai','google','local','azure')),
	CONSTRAINT "dispatches_status_check" CHECK("dispatches"."status" in ('success','error'))
);
--> statement-breakpoint
CREATE INDEX `idx_dispatches_review_phase` ON `dispatches` (`review_id`,`phase`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`agent` text NOT NULL,
	`phase` text NOT NULL,
	`type` text NOT NULL,
	`claim` text NOT NULL,
	`manuscript_anchor` text NOT NULL,
	`epistemic_status` text NOT NULL,
	`confidence` real NOT NULL,
	`confidence_band` text NOT NULL,
	`severity` text NOT NULL,
	`fixability` text NOT NULL,
	`scope` text NOT NULL,
	`narrative_context` text,
	`recommended_action` text,
	`supersedes_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supersedes_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "findings_epistemic_status_check" CHECK("findings"."epistemic_status" in ('Known','Inferred','Assumption')),
	CONSTRAINT "findings_confidence_check" CHECK("findings"."confidence" >= 0 and "findings"."confidence" <= 1),
	CONSTRAINT "findings_confidence_band_check" CHECK("findings"."confidence_band" in ('Green','Yellow','Red')),
	CONSTRAINT "findings_severity_check" CHECK("findings"."severity" in ('none','minor','moderate','major','fatal')),
	CONSTRAINT "findings_fixability_check" CHECK("findings"."fixability" in ('easy','moderate','hard','not_fixable_from_current_study','unclear')),
	CONSTRAINT "findings_scope_check" CHECK("findings"."scope" in ('author_facing','editor_only','both'))
);
--> statement-breakpoint
CREATE INDEX `idx_findings_review` ON `findings` (`review_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_review_phase` ON `findings` (`review_id`,`phase`);--> statement-breakpoint
CREATE INDEX `idx_findings_supersedes` ON `findings` (`supersedes_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_severity` ON `findings` (`review_id`,`severity`);--> statement-breakpoint
CREATE TABLE `manuscripts` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`blob_path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`sanitized_text` text,
	`tei_structure_path` text,
	`quarantine_tier` integer,
	`quarantine_log_json` text,
	`ingested_at` text NOT NULL,
	`sanitized_at` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "manuscripts_quarantine_tier_check" CHECK("manuscripts"."quarantine_tier" in (1,2,3)),
	CONSTRAINT "manuscripts_sha256_length_check" CHECK(length("manuscripts"."sha256") = 64)
);
--> statement-breakpoint
CREATE INDEX `idx_manuscripts_review` ON `manuscripts` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `manuscripts_review_sha256_unique` ON `manuscripts` (`review_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `phase_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`phase` text NOT NULL,
	`status` text NOT NULL,
	`gate_verdict` text,
	`fix_cycle_count` integer DEFAULT 0 NOT NULL,
	`snapshot_json` text,
	`started_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "phase_checkpoints_status_check" CHECK("phase_checkpoints"."status" in ('pending','in_progress','completed','failed','skipped')),
	CONSTRAINT "phase_checkpoints_gate_verdict_check" CHECK("phase_checkpoints"."gate_verdict" in ('pass','revise','revise_specialist','block','arbitrated'))
);
--> statement-breakpoint
CREATE INDEX `idx_checkpoints_review` ON `phase_checkpoints` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `phase_checkpoints_review_phase_unique` ON `phase_checkpoints` (`review_id`,`phase`);--> statement-breakpoint
CREATE TABLE `provider_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`wrapped_dek` blob NOT NULL,
	`dek_iv` blob NOT NULL,
	`dek_auth_tag` blob NOT NULL,
	`base_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "provider_keys_provider_check" CHECK("provider_keys"."provider" in ('anthropic','openai','google','local')),
	CONSTRAINT "provider_keys_iv_length_check" CHECK(length("provider_keys"."iv") = 12),
	CONSTRAINT "provider_keys_auth_tag_length_check" CHECK(length("provider_keys"."auth_tag") = 16),
	CONSTRAINT "provider_keys_dek_iv_length_check" CHECK(length("provider_keys"."dek_iv") = 12),
	CONSTRAINT "provider_keys_dek_auth_tag_length_check" CHECK(length("provider_keys"."dek_auth_tag") = 16)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_keys_provider_label_unique` ON `provider_keys` (`provider`,`label`);--> statement-breakpoint
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
	CONSTRAINT "review_events_kind_check" CHECK("review_events"."kind" in ('phase_transition','gate_verdict','arbitration','web_query','control_ack','deliverable_released','finding_recorded','run_terminal','error')),
	CONSTRAINT "review_events_egress_target_check" CHECK("review_events"."egress_target" in ('crossref','openalex','semantic_scholar'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_review_seq` ON `review_events` (`review_id`,`seq`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'created' NOT NULL,
	`current_phase` text,
	`recommendation` text,
	`recommendation_confidence` real,
	`provider_profile` text DEFAULT 'default' NOT NULL,
	`options_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error_class` text,
	CONSTRAINT "reviews_status_check" CHECK("reviews"."status" in ('created','queued','sanitizing','running','paused','awaiting_input','completed','failed','cancelled')),
	CONSTRAINT "reviews_current_phase_check" CHECK("reviews"."current_phase" in ('phase_0','phase_1','phase_2','phase_3','phase_4','phase_5','phase_6','phase_7','phase_8')),
	CONSTRAINT "reviews_recommendation_check" CHECK("reviews"."recommendation" in ('accept','minor_revision','major_revision','reject_and_resubmit','reject')),
	CONSTRAINT "reviews_recommendation_confidence_check" CHECK("reviews"."recommendation_confidence" >= 0 and "reviews"."recommendation_confidence" <= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_slug_unique` ON `reviews` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_reviews_status` ON `reviews` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reviews_created_at` ON `reviews` (`created_at`);--> statement-breakpoint
CREATE TABLE `rubric_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`criterion` text NOT NULL,
	`criterion_index` integer NOT NULL,
	`score` integer NOT NULL,
	`justifying_finding_ids` text DEFAULT '[]' NOT NULL,
	`state` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rubric_scores_criterion_index_check" CHECK("rubric_scores"."criterion_index" >= 1 and "rubric_scores"."criterion_index" <= 15),
	CONSTRAINT "rubric_scores_score_check" CHECK("rubric_scores"."score" >= 0 and "rubric_scores"."score" <= 5),
	CONSTRAINT "rubric_scores_state_check" CHECK("rubric_scores"."state" in ('provisional','final'))
);
--> statement-breakpoint
CREATE INDEX `idx_rubric_review` ON `rubric_scores` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rubric_scores_review_criterion_unique` ON `rubric_scores` (`review_id`,`criterion_index`);--> statement-breakpoint
CREATE TABLE `run_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`command` text NOT NULL,
	`args_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "run_commands_command_check" CHECK("run_commands"."command" in ('run','pause','resume','cancel','retry_phase'))
);
--> statement-breakpoint
CREATE INDEX `idx_run_commands_review` ON `run_commands` (`review_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
