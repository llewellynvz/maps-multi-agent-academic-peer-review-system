import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title'),
    status: text('status').notNull().default('created'),
    currentPhase: text('current_phase'),
    recommendation: text('recommendation'),
    recommendationConfidence: real('recommendation_confidence'),
    providerProfile: text('provider_profile').notNull().default('default'),
    optionsJson: text('options_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    errorClass: text('error_class'),
  },
  (t) => [
    check(
      'reviews_status_check',
      sql`${t.status} in ('created','queued','sanitizing','running','paused','awaiting_input','completed','failed','cancelled')`,
    ),
    check(
      'reviews_current_phase_check',
      sql`${t.currentPhase} in ('phase_0','phase_1','phase_2','phase_3','phase_4','phase_5','phase_6','phase_7','phase_8')`,
    ),
    check(
      'reviews_recommendation_check',
      sql`${t.recommendation} in ('accept','minor_revision','major_revision','reject_and_resubmit','reject')`,
    ),
    check(
      'reviews_recommendation_confidence_check',
      sql`${t.recommendationConfidence} >= 0 and ${t.recommendationConfidence} <= 1`,
    ),
    index('idx_reviews_status').on(t.status),
    index('idx_reviews_created_at').on(t.createdAt),
  ],
);

export const manuscripts = sqliteTable(
  'manuscripts',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    blobPath: text('blob_path').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    sanitizedText: text('sanitized_text'),
    teiStructurePath: text('tei_structure_path'),
    quarantineTier: integer('quarantine_tier'),
    quarantineLogJson: text('quarantine_log_json'),
    ingestedAt: text('ingested_at').notNull(),
    sanitizedAt: text('sanitized_at'),
  },
  (t) => [
    check('manuscripts_quarantine_tier_check', sql`${t.quarantineTier} in (1,2,3)`),
    check('manuscripts_sha256_length_check', sql`length(${t.sha256}) = 64`),
    unique('manuscripts_review_sha256_unique').on(t.reviewId, t.sha256),
    index('idx_manuscripts_review').on(t.reviewId),
  ],
);

export const findings = sqliteTable(
  'findings',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    agent: text('agent').notNull(),
    phase: text('phase').notNull(),
    type: text('type').notNull(),
    claim: text('claim').notNull(),
    manuscriptAnchor: text('manuscript_anchor').notNull(),
    epistemicStatus: text('epistemic_status').notNull(),
    confidence: real('confidence').notNull(),
    confidenceBand: text('confidence_band').notNull(),
    severity: text('severity').notNull(),
    fixability: text('fixability').notNull(),
    scope: text('scope').notNull(),
    narrativeContext: text('narrative_context'),
    recommendedAction: text('recommended_action'),
    supersedesId: text('supersedes_id').references((): AnySQLiteColumn => findings.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('findings_epistemic_status_check', sql`${t.epistemicStatus} in ('Known','Inferred','Assumption')`),
    check('findings_confidence_check', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    check('findings_confidence_band_check', sql`${t.confidenceBand} in ('Green','Yellow','Red')`),
    check('findings_severity_check', sql`${t.severity} in ('none','minor','moderate','major','fatal')`),
    check(
      'findings_fixability_check',
      sql`${t.fixability} in ('easy','moderate','hard','not_fixable_from_current_study','unclear')`,
    ),
    check('findings_scope_check', sql`${t.scope} in ('author_facing','editor_only','both')`),
    index('idx_findings_review').on(t.reviewId),
    index('idx_findings_review_phase').on(t.reviewId, t.phase),
    index('idx_findings_supersedes').on(t.supersedesId),
    index('idx_findings_severity').on(t.reviewId, t.severity),
  ],
);

export const phaseCheckpoints = sqliteTable(
  'phase_checkpoints',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    phase: text('phase').notNull(),
    status: text('status').notNull(),
    gateVerdict: text('gate_verdict'),
    fixCycleCount: integer('fix_cycle_count').notNull().default(0),
    snapshotJson: text('snapshot_json'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('phase_checkpoints_status_check', sql`${t.status} in ('pending','in_progress','completed','failed','skipped')`),
    check(
      'phase_checkpoints_gate_verdict_check',
      sql`${t.gateVerdict} in ('pass','revise','revise_specialist','block','arbitrated')`,
    ),
    unique('phase_checkpoints_review_phase_unique').on(t.reviewId, t.phase),
    index('idx_checkpoints_review').on(t.reviewId),
  ],
);

export const reviewEvents = sqliteTable(
  'review_events',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ts: text('ts').notNull(),
    kind: text('kind').notNull(),
    phase: text('phase'),
    payloadJson: text('payload_json').notNull().default('{}'),
    egressTarget: text('egress_target'),
    egressQuery: text('egress_query'),
  },
  (t) => [
    check(
      'review_events_kind_check',
      sql`${t.kind} in ('phase_transition','gate_verdict','arbitration','web_query','control_ack','deliverable_released','finding_recorded','run_terminal','phase_critique','error')`,
    ),
    check('review_events_egress_target_check', sql`${t.egressTarget} in ('crossref','openalex','semantic_scholar')`),
    uniqueIndex('idx_events_review_seq').on(t.reviewId, t.seq),
  ],
);

export const dispatches = sqliteTable(
  'dispatches',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    phase: text('phase').notNull(),
    agent: text('agent').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    tokensCached: integer('tokens_cached').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    costUsd: real('cost_usd').notNull().default(0),
    retries: integer('retries').notNull().default(0),
    status: text('status').notNull(),
    errorClass: text('error_class'),
    langfuseTraceId: text('langfuse_trace_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('dispatches_provider_check', sql`${t.provider} in ('anthropic','openai','google','local','azure')`),
    check('dispatches_status_check', sql`${t.status} in ('success','error')`),
    index('idx_dispatches_review_phase').on(t.reviewId, t.phase),
  ],
);

export const rubricScores = sqliteTable(
  'rubric_scores',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    criterion: text('criterion').notNull(),
    criterionIndex: integer('criterion_index').notNull(),
    score: integer('score').notNull(),
    justifyingFindingIds: text('justifying_finding_ids').notNull().default('[]'),
    state: text('state').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('rubric_scores_criterion_index_check', sql`${t.criterionIndex} >= 1 and ${t.criterionIndex} <= 15`),
    check('rubric_scores_score_check', sql`${t.score} >= 0 and ${t.score} <= 5`),
    check('rubric_scores_state_check', sql`${t.state} in ('provisional','final')`),
    unique('rubric_scores_review_criterion_unique').on(t.reviewId, t.criterionIndex),
    index('idx_rubric_review').on(t.reviewId),
  ],
);

export const deliverables = sqliteTable(
  'deliverables',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    format: text('format').notNull(),
    path: text('path').notNull(),
    checksum: text('checksum').notNull(),
    byteSize: integer('byte_size').notNull(),
    released: integer('released').notNull().default(0),
    releasedAt: text('released_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'deliverables_kind_check',
      sql`${t.kind} in ('peer_review_report','reviewer_private_notes','ledger_export','run_archive')`,
    ),
    check('deliverables_format_check', sql`${t.format} in ('docx','md','zip')`),
    check('deliverables_checksum_length_check', sql`length(${t.checksum}) = 64`),
    unique('deliverables_review_kind_format_unique').on(t.reviewId, t.kind, t.format),
    index('idx_deliverables_review').on(t.reviewId),
  ],
);

export const providerKeys = sqliteTable(
  'provider_keys',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    label: text('label'),
    ciphertext: blob('ciphertext').notNull(),
    iv: blob('iv').notNull(),
    authTag: blob('auth_tag').notNull(),
    wrappedDek: blob('wrapped_dek').notNull(),
    dekIv: blob('dek_iv').notNull(),
    dekAuthTag: blob('dek_auth_tag').notNull(),
    baseUrl: text('base_url'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('provider_keys_provider_check', sql`${t.provider} in ('anthropic','openai','google','local')`),
    check('provider_keys_iv_length_check', sql`length(${t.iv}) = 12`),
    check('provider_keys_auth_tag_length_check', sql`length(${t.authTag}) = 16`),
    check('provider_keys_dek_iv_length_check', sql`length(${t.dekIv}) = 12`),
    check('provider_keys_dek_auth_tag_length_check', sql`length(${t.dekAuthTag}) = 16`),
    unique('provider_keys_provider_label_unique').on(t.provider, t.label),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const runCommands = sqliteTable(
  'run_commands',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    command: text('command').notNull(),
    argsJson: text('args_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('run_commands_command_check', sql`${t.command} in ('run','pause','resume','cancel','retry_phase')`),
    index('idx_run_commands_review').on(t.reviewId, t.createdAt),
  ],
);
