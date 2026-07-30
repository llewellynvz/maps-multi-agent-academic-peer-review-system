import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { MaraClient, MaraDatabase } from '../db/client';
import { manuscripts, reviewEvents, reviews, runCommands } from '../db/schema';
import { getReviewOptions, insertEvent, mergeReviewOptions, pauseReview, updateReview } from '../workflow/repo';
import { submitAutoRetryPhase } from '../data/commands';
import { readSetting, writeSetting } from '../data/settings-store';
import { deleteArtefactsByPrefix, readArtefactsByPrefix } from '../engine/artefacts';
import { writeHeartbeat } from '../data/heartbeat';
import type { StopSignal } from './supervisor';

export type IngestOutcome = 'suspended' | 'ingested' | 'halted';
export type EngineResult = 'completed' | 'paused' | 'cancelled' | 'stopped' | 'failed';

const WORKER_LEASE_KEY = 'worker_lease';
const QUEUEABLE_STATUSES = new Set(['created', 'awaiting_input', 'paused']);
const RESUMABLE_STATUSES = new Set(['awaiting_input', 'paused']);
const MAX_AUTO_RETRIES = 2;
const AUTO_RETRY_CLASSES = new Set(['release_gate_block', 'engine_error']);

interface WorkerLease {
  workerId: string;
  heartbeatAt: string;
}

export interface WorkerProcessors {
  startIngest: (reviewId: string, args: Record<string, unknown>) => Promise<IngestOutcome>;
  resumeIngest: (reviewId: string, answers: Record<string, string>, preset: string | undefined) => Promise<IngestOutcome>;
  runEngine: (reviewId: string, shouldStop: () => StopSignal) => Promise<EngineResult>;
  ingestResumable?: (reviewId: string) => Promise<boolean> | boolean;
}

interface Intent {
  kind: 'ingest' | 'resume' | 'run';
  args: Record<string, unknown>;
  answers?: Record<string, string>;
  preset?: string;
  createdAt: string;
  recovered?: boolean;
}

export interface WorkerRunnerOptions {
  client: MaraClient;
  processors: WorkerProcessors;
  pollMs?: number;
  onLog?: (message: string) => void;
  staleLeaseMs?: number;
  awaitingInputTimeoutMs?: number;
  now?: () => number;
  workerId?: string;
}

export class WorkerRunner {
  private readonly client: MaraClient;
  private readonly db: MaraDatabase;
  private readonly processors: WorkerProcessors;
  private readonly pollMs: number;
  private readonly log: (message: string) => void;
  private readonly workerId: string;
  private readonly staleLeaseMs: number;
  private readonly awaitingInputTimeoutMs: number;
  private readonly now: () => number;

  private activeReviewId: string | null = null;
  private readonly intents = new Map<string, Intent>();
  private readonly pauseRequested = new Set<string>();
  private readonly cancelRequested = new Set<string>();
  private readonly ackedCommands = new Set<string>();
  private ackedLoaded = false;
  private recovered = false;
  private stopping = false;
  private processing: Promise<void> | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WorkerRunnerOptions) {
    this.client = options.client;
    this.db = options.client.db;
    this.processors = options.processors;
    this.pollMs = options.pollMs ?? 500;
    this.log = options.onLog ?? (() => undefined);
    this.workerId = options.workerId ?? randomUUID();
    this.staleLeaseMs = options.staleLeaseMs ?? 60_000;
    this.awaitingInputTimeoutMs = options.awaitingInputTimeoutMs ?? 86_400_000;
    this.now = options.now ?? Date.now;
  }

  get active(): string | null {
    return this.activeReviewId;
  }

  private loadAckedCommands(): void {
    const rows = this.db.select().from(reviewEvents).where(eq(reviewEvents.kind, 'control_ack')).all();
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payloadJson) as { commandId?: string };
        if (typeof payload.commandId === 'string') {
          this.ackedCommands.add(payload.commandId);
        }
      } catch {
        continue;
      }
    }
    this.ackedLoaded = true;
  }

  private acquireLease(): boolean {
    const nowMs = this.now();
    return this.db.transaction(
      (tx) => {
        const current = readSetting<WorkerLease>(tx, WORKER_LEASE_KEY);
        if (current !== undefined && current.workerId !== this.workerId) {
          const age = nowMs - Date.parse(current.heartbeatAt);
          if (Number.isFinite(age) && age < this.staleLeaseMs) {
            return false;
          }
        } else if (current !== undefined) {
          const age = nowMs - Date.parse(current.heartbeatAt);
          if (Number.isFinite(age) && age < this.staleLeaseMs / 3) {
            return true;
          }
        }
        writeSetting(tx, WORKER_LEASE_KEY, { workerId: this.workerId, heartbeatAt: new Date(nowMs).toISOString() });
        return true;
      },
      { behavior: 'immediate' },
    );
  }

  private ensureLease(): boolean {
    const held = this.acquireLease();
    if (held && !this.recovered) {
      this.recover();
    }
    return held;
  }

  pollCommands(): void {
    if (!this.ackedLoaded) {
      this.loadAckedCommands();
    }
    const commands = this.db.select().from(runCommands).orderBy(asc(runCommands.createdAt)).all();
    for (const command of commands) {
      if (this.ackedCommands.has(command.id)) {
        continue;
      }
      const args = safeArgs(command.argsJson);
      if (command.command === 'run' || command.command === 'resume' || command.command === 'retry_phase') {
        let retryStart: number | null = null;
        try {
          retryStart = this.db.transaction(
            (tx) => {
              const start =
                command.command === 'retry_phase' ? this.applyRetryPhaseDb(tx, command.reviewId, args) : null;
              insertEvent(tx, {
                reviewId: command.reviewId,
                kind: 'control_ack',
                payload: { commandId: command.id, command: command.command },
              });
              tx.delete(runCommands).where(eq(runCommands.id, command.id)).run();
              if (command.command !== 'retry_phase') {
                this.applyDurable(tx, command.reviewId, command.command, args);
              }
              return start;
            },
            { behavior: 'immediate' },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log(`could not apply ${command.command} for ${command.reviewId}: ${message}`);
          if (command.command === 'retry_phase') {
            this.discardPoisonCommand(command.id, command.reviewId, message);
          }
          continue;
        }
        if (retryStart !== null) {
          try {
            this.invalidateFilesFromPhase(command.reviewId, retryStart);
            mergeReviewOptions(this.db, command.reviewId, { pendingInvalidateFrom: null });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`review ${command.reviewId}: artefact invalidation incomplete, will finish on recovery: ${message}`);
          }
        }
        this.applyMemory(command.reviewId, command.command, args, command.createdAt);
      } else {
        this.applyCommand(command.reviewId, command.command);
        insertEvent(this.db, {
          reviewId: command.reviewId,
          kind: 'control_ack',
          payload: { commandId: command.id, command: command.command },
        });
        this.db.delete(runCommands).where(eq(runCommands.id, command.id)).run();
      }
      this.ackedCommands.add(command.id);
      this.log(`command ${command.command} for ${command.reviewId}`);
    }
  }

  private applyDurable(tx: MaraDatabase, reviewId: string, command: string, args: Record<string, unknown>): void {
    if (command === 'resume') {
      const answers = (args.answers as Record<string, string> | undefined) ?? {};
      const preset = typeof args.preset === 'string' ? args.preset : undefined;
      mergeReviewOptions(tx, reviewId, { pendingResume: { answers, ...(preset !== undefined ? { preset } : {}) } });
      if (RESUMABLE_STATUSES.has(this.currentStatus(tx, reviewId) ?? '')) {
        updateReview(tx, reviewId, { status: 'queued' });
      }
      return;
    }
    if (QUEUEABLE_STATUSES.has(this.currentStatus(tx, reviewId) ?? '')) {
      updateReview(tx, reviewId, { status: 'queued' });
    }
  }

  private applyMemory(reviewId: string, command: string, args: Record<string, unknown>, createdAt: string): void {
    this.cancelRequested.delete(reviewId);
    this.pauseRequested.delete(reviewId);
    if (command === 'resume') {
      this.intents.set(reviewId, {
        kind: 'resume',
        args,
        answers: (args.answers as Record<string, string> | undefined) ?? {},
        preset: typeof args.preset === 'string' ? args.preset : undefined,
        createdAt,
      });
      return;
    }
    const kind = args.trigger === 'ingest' ? 'ingest' : 'run';
    this.intents.set(reviewId, { kind, args, createdAt });
  }

  private currentStatus(tx: MaraDatabase, reviewId: string): string | undefined {
    return tx.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0]?.status;
  }

  private applyCommand(reviewId: string, command: string): void {
    switch (command) {
      case 'pause': {
        this.pauseRequested.add(reviewId);
        break;
      }
      case 'cancel': {
        this.cancelRequested.add(reviewId);
        this.intents.delete(reviewId);
        if (this.activeReviewId !== reviewId) {
          updateReview(this.db, reviewId, { status: 'cancelled' });
          this.emitTerminal(reviewId, 'cancelled', {});
        }
        break;
      }
      default:
        break;
    }
  }

  private discardPoisonCommand(commandId: string, reviewId: string, message: string): void {
    try {
      this.db.delete(runCommands).where(eq(runCommands.id, commandId)).run();
      this.ackedCommands.add(commandId);
    } catch (discardError) {
      const detail = discardError instanceof Error ? discardError.message : String(discardError);
      this.log(`could not discard poison retry command ${commandId}: ${detail}`);
      return;
    }
    try {
      insertEvent(this.db, {
        reviewId,
        kind: 'error',
        payload: { message: `A retry command could not be applied and was discarded: ${message}` },
      });
      insertEvent(this.db, { reviewId, kind: 'control_ack', payload: { commandId, command: 'retry_phase' } });
    } catch {
      this.log(`poison retry command ${commandId} discarded without an audit event (review row missing)`);
    }
  }

  private resetPhaseCheckpoint(reviewId: string, phase: string, clearSnapshot = false): void {
    const key = phase.startsWith('engine_') ? phase : `engine_${phase}`;
    if (clearSnapshot) {
      this.client.sqlite
        .prepare("UPDATE phase_checkpoints SET status = 'pending', snapshot_json = NULL, updated_at = ? WHERE review_id = ? AND phase = ?")
        .run(new Date().toISOString(), reviewId, key);
      return;
    }
    this.client.sqlite
      .prepare("UPDATE phase_checkpoints SET status = 'pending', updated_at = ? WHERE review_id = ? AND phase = ?")
      .run(new Date().toISOString(), reviewId, key);
  }

  private reviewErrorClass(reviewId: string): string | null {
    const row = this.client.sqlite.prepare('SELECT error_class FROM reviews WHERE id = ?').get(reviewId) as
      | { error_class: string | null }
      | undefined;
    return row?.error_class ?? null;
  }

  private applyRetryPhaseDb(tx: MaraDatabase, reviewId: string, args: Record<string, unknown>): number | null {
    const phase = typeof args.phase === 'string' ? args.phase : '';
    if (phase === '') {
      return null;
    }
    const auto = args.auto === true;
    const errorClass = this.reviewErrorClass(reviewId);
    const gateRetry = errorClass === 'release_gate_block';
    const startMatch = /phase_(\d+)/.exec(phase);
    let start = startMatch !== null ? Number.parseInt(startMatch[1]!, 10) : 7;
    const gateCheckpoint = this.client.sqlite
      .prepare("SELECT status, snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = 'engine_phase_7'")
      .get(reviewId) as { status: string; snapshot_json: string | null } | undefined;
    let gateSnapshot: { released?: boolean; blocked?: boolean; reason?: string } | null = null;
    try {
      gateSnapshot = gateCheckpoint?.snapshot_json != null ? JSON.parse(gateCheckpoint.snapshot_json) : null;
    } catch {
      gateSnapshot = null;
    }
    if (gateRetry && start > 7 && gateCheckpoint?.status === 'completed' && gateSnapshot?.released === false) {
      start = 7;
    }

    if (gateRetry) {
      const cycleFindingIds = new Set<string>();
      const collectIds = (value: unknown): void => {
        const ids = (value as { mergedIds?: unknown }).mergedIds;
        if (Array.isArray(ids)) {
          for (const id of ids) {
            if (typeof id === 'string') {
              cycleFindingIds.add(id);
            }
          }
        }
      };
      for (let n = start; n <= 8; n += 1) {
        for (const entry of readArtefactsByPrefix(reviewId, `merge-p${n}-`)) {
          collectIds(entry.value);
        }
        const markerRows = this.client.sqlite
          .prepare('SELECT merged_ids_json FROM merge_markers WHERE review_id = ? AND marker LIKE ?')
          .all(reviewId, `p${n}-%`) as Array<{ merged_ids_json: string }>;
        for (const row of markerRows) {
          collectIds({ mergedIds: JSON.parse(row.merged_ids_json) });
        }
        const markers = this.client.sqlite
          .prepare('DELETE FROM merge_markers WHERE review_id = ? AND marker LIKE ?')
          .run(reviewId, `p${n}-%`);
        this.resetPhaseCheckpoint(reviewId, `phase_${n}`, n === 7 && start < 7);
        if (markers.changes > 0) {
          this.log(`review ${reviewId}: invalidated ${markers.changes} phase_${n} merge markers for gate retry`);
        }
      }
      if (cycleFindingIds.size > 0) {
        const ids = [...cycleFindingIds];
        const placeholders = ids.map(() => '?').join(',');
        const purge = this.client.sqlite.transaction(() => {
          this.client.sqlite.pragma('defer_foreign_keys = ON');
          this.client.sqlite.exec('CREATE TEMP TABLE IF NOT EXISTS _mara_purge (marker INTEGER)');
          this.client.sqlite
            .prepare(`DELETE FROM findings WHERE review_id = ? AND id IN (${placeholders})`)
            .run(reviewId, ...ids);
          this.client.sqlite.exec('DROP TABLE IF EXISTS _mara_purge');
        });
        purge();
        this.log(`review ${reviewId}: purged ${ids.length} invalidated-cycle ledger rows for gate retry`);
      }
      mergeReviewOptions(tx, reviewId, { pendingInvalidateFrom: start });
    } else {
      this.resetPhaseCheckpoint(reviewId, phase);
    }

    this.client.sqlite
      .prepare('UPDATE reviews SET error_class = NULL, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), reviewId);
    if (this.currentStatus(tx, reviewId) === 'failed') {
      updateReview(tx, reviewId, { status: 'queued' });
    }

    const attempt = auto ? this.countAutoRetries(reviewId) + 1 : null;
    const reason = gateRetry
      ? 'the release gate blocked the deliverables'
      : `a transient engine error interrupted ${phase}`;
    // Advance the event sequence past the prior terminal so a fresh terminal is never suppressed by
    // the intra-run dedup, even if the re-run throws before it emits its own first event.
    insertEvent(tx, {
      reviewId,
      kind: 'phase_transition',
      phase: `phase_${start}`,
      payload: {
        retry: true,
        invalidatedFrom: start,
        auto,
        ...(attempt !== null ? { attempt, maxAttempts: MAX_AUTO_RETRIES } : {}),
        reason,
      },
    });
    return gateRetry ? start : null;
  }

  private invalidateFilesFromPhase(reviewId: string, start: number): void {
    for (let n = start; n <= 8; n += 1) {
      const removed = deleteArtefactsByPrefix(reviewId, `p${n}-`);
      deleteArtefactsByPrefix(reviewId, `merge-p${n}-`);
      if (removed.length > 0) {
        this.log(`review ${reviewId}: invalidated ${removed.length} phase_${n} artefacts for gate retry`);
      }
    }
  }

  private countAutoRetries(reviewId: string): number {
    const row = this.client.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM review_events WHERE review_id = ? AND kind = 'phase_transition' AND json_extract(payload_json, '$.retry') = 1 AND json_extract(payload_json, '$.auto') = 1",
      )
      .get(reviewId) as { n: number };
    return row.n;
  }

  private maybeScheduleAutoRetry(reviewId: string, errorClass: string): void {
    if (!AUTO_RETRY_CLASSES.has(errorClass)) {
      return;
    }
    const attempts = this.countAutoRetries(reviewId);
    if (attempts >= MAX_AUTO_RETRIES) {
      this.log(`review ${reviewId}: auto-retry budget exhausted after ${attempts} attempts; leaving failed for manual retry`);
      return;
    }
    const review = this.db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0];
    const phase = errorClass === 'release_gate_block' ? 'phase_7' : (review?.currentPhase ?? 'phase_7');
    try {
      const result = submitAutoRetryPhase(this.db, reviewId, phase);
      if (result.noop !== true) {
        this.log(`review ${reviewId}: scheduled auto-retry ${attempts + 1} of ${MAX_AUTO_RETRIES} for ${phase} (${errorClass})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`review ${reviewId}: could not schedule auto-retry: ${message}`);
    }
  }

  private clearPendingResume(reviewId: string): void {
    const options = getReviewOptions(this.db, reviewId);
    if (options.pendingResume !== undefined && options.pendingResume !== null) {
      mergeReviewOptions(this.db, reviewId, { pendingResume: null });
    }
  }

  private pendingInvalidateFrom(optionsJson: string): number | null {
    try {
      const options = JSON.parse(optionsJson) as { pendingInvalidateFrom?: unknown };
      if (typeof options.pendingInvalidateFrom === 'number') {
        return options.pendingInvalidateFrom;
      }
    } catch {}
    return null;
  }

  private pendingResume(optionsJson: string): { answers: Record<string, string>; preset?: string } | undefined {
    try {
      const options = JSON.parse(optionsJson) as { pendingResume?: unknown };
      const marker = options.pendingResume;
      if (marker !== null && typeof marker === 'object') {
        const { answers, preset } = marker as { answers?: unknown; preset?: unknown };
        if (answers !== null && typeof answers === 'object') {
          return {
            answers: answers as Record<string, string>,
            ...(typeof preset === 'string' ? { preset } : {}),
          };
        }
      }
    } catch {}
    return undefined;
  }

  pickNext(): string | null {
    if (this.activeReviewId !== null) {
      return null;
    }
    let best: { reviewId: string; createdAt: string; recovered: boolean } | null = null;
    for (const [reviewId, intent] of this.intents) {
      if (this.cancelRequested.has(reviewId)) {
        continue;
      }
      const recovered = intent.recovered === true;
      if (
        best === null ||
        (!recovered && best.recovered) ||
        (recovered === best.recovered && intent.createdAt < best.createdAt)
      ) {
        best = { reviewId, createdAt: intent.createdAt, recovered };
      }
    }
    return best?.reviewId ?? null;
  }

  private markQueued(): void {
    if (this.activeReviewId === null) {
      return;
    }
    for (const reviewId of this.intents.keys()) {
      if (reviewId === this.activeReviewId) {
        continue;
      }
      const row = this.db.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0];
      if (row !== undefined && QUEUEABLE_STATUSES.has(row.status)) {
        updateReview(this.db, reviewId, { status: 'queued' });
      }
    }
  }

  async processReview(reviewId: string): Promise<void> {
    const row = this.db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, reviewId)).limit(1).all();
    if (row.length === 0) {
      this.intents.delete(reviewId);
      this.cancelRequested.delete(reviewId);
      this.log(`review ${reviewId} no longer exists; dropping its queued command`);
      return;
    }
    const intent = this.intents.get(reviewId) ?? { kind: 'run', args: {}, createdAt: new Date().toISOString() };
    this.intents.delete(reviewId);
    this.activeReviewId = reviewId;
    const startedMs = Date.now();
    const runStartSeq = this.maxEventSeq(reviewId);

    try {
      if (this.cancelRequested.has(reviewId)) {
        updateReview(this.db, reviewId, { status: 'cancelled' });
        this.emitTerminal(reviewId, 'cancelled', {});
        return;
      }

      const ingested = this.ingestComplete(reviewId);
      if (!ingested) {
        let outcome: IngestOutcome;
        if (intent.kind === 'resume') {
          const resumable =
            this.processors.ingestResumable === undefined || (await this.processors.ingestResumable(reviewId));
          if (resumable) {
            outcome = await this.processors.resumeIngest(reviewId, intent.answers ?? {}, intent.preset);
          } else {
            this.log(`ingest snapshot missing for ${reviewId}; restarting ingest from the manuscript blob`);
            insertEvent(this.db, {
              reviewId,
              kind: 'error',
              phase: 'phase_0',
              payload: { reason: 'ingest_snapshot_missing', action: 'restart_ingest' },
            });
            outcome = await this.processors.startIngest(reviewId, this.recoveredArgs(reviewId));
          }
          this.clearPendingResume(reviewId);
        } else {
          outcome = await this.processors.startIngest(reviewId, intent.args);
        }
        if (outcome === 'suspended') {
          if (this.cancelRequested.has(reviewId)) {
            updateReview(this.db, reviewId, { status: 'cancelled' });
            this.emitTerminal(reviewId, 'cancelled', {});
          }
          return;
        }
        if (outcome === 'halted') {
          this.emitTerminal(reviewId, 'failed', { errorClass: 'quarantine_tier_3', phase: 'phase_0' });
          return;
        }
      }

      if (this.pauseRequested.has(reviewId)) {
        this.pauseRequested.delete(reviewId);
        updateReview(this.db, reviewId, { status: 'paused' });
        return;
      }

      const result = await this.processors.runEngine(reviewId, () => this.shouldStop(reviewId));
      const durationMs = Date.now() - startedMs;
      this.finishEngine(reviewId, result, durationMs, runStartSeq);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.shouldStop(reviewId) === 'shutdown') {
        this.log(`review ${reviewId} interrupted after losing the worker slot: ${message}`);
        return;
      }
      updateReview(this.db, reviewId, { status: 'failed', errorClass: 'engine_error' });
      this.emitTerminal(
        reviewId,
        'failed',
        { errorClass: 'engine_error', message: 'the worker hit an unrecoverable error while finishing the run' },
        runStartSeq,
      );
      this.log(`review ${reviewId} failed: ${message}`);
    } finally {
      this.pauseRequested.delete(reviewId);
      this.activeReviewId = null;
    }
  }

  private finishEngine(reviewId: string, result: EngineResult, durationMs: number, runStartSeq: number): void {
    if (result === 'completed') {
      const review = this.db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0];
      if (review?.status === 'completed') {
        this.emitTerminal(
          reviewId,
          'complete',
          { recommendation: review.recommendation ?? null, durationMs },
          runStartSeq,
        );
        return;
      }
      const errorClass = review?.errorClass ?? 'not_released';
      updateReview(this.db, reviewId, { status: 'failed', errorClass });
      const message =
        errorClass === 'release_gate_block'
          ? 'the release gate blocked the deliverables after the fix-cycle budget was exhausted'
          : 'the review finished the pipeline without reaching a released state';
      this.emitTerminal(reviewId, 'failed', { errorClass, message, durationMs }, runStartSeq);
      this.maybeScheduleAutoRetry(reviewId, errorClass);
    } else if (result === 'paused') {
      this.pauseRequested.delete(reviewId);
      updateReview(this.db, reviewId, { status: 'paused' });
    } else if (result === 'cancelled') {
      updateReview(this.db, reviewId, { status: 'cancelled' });
      this.emitTerminal(reviewId, 'cancelled', {}, runStartSeq);
    } else if (result === 'failed') {
      this.emitTerminal(
        reviewId,
        'failed',
        { errorClass: 'engine_error', message: 'the engine reported an unrecoverable failure' },
        runStartSeq,
      );
      this.maybeScheduleAutoRetry(reviewId, 'engine_error');
    }
  }

  private maxEventSeq(reviewId: string): number {
    const row = this.client.sqlite.prepare('SELECT max(seq) AS s FROM review_events WHERE review_id = ?').get(reviewId) as {
      s: number | null;
    };
    return row.s ?? 0;
  }

  private emitTerminal(reviewId: string, outcome: string, extra: Record<string, unknown>, sinceSeq?: number): void {
    const exists = this.db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, reviewId)).limit(1).all();
    if (exists.length === 0) {
      this.log(`review ${reviewId} was deleted while it was being processed; suppressing its terminal event`);
      return;
    }
    if (sinceSeq !== undefined) {
      // Suppress only when a terminal already landed during this run, so an intervening event cannot trigger a second contradictory terminal.
      const termThisRun = this.client.sqlite
        .prepare("SELECT max(seq) AS s FROM review_events WHERE review_id = ? AND kind = 'run_terminal'")
        .get(reviewId) as { s: number | null };
      if (termThisRun.s !== null && termThisRun.s > sinceSeq) {
        return;
      }
    } else {
      const seqs = this.client.sqlite
        .prepare(
          "SELECT (SELECT max(seq) FROM review_events WHERE review_id = ? AND kind = 'run_terminal') AS lastTerm, (SELECT max(seq) FROM review_events WHERE review_id = ?) AS maxSeq",
        )
        .get(reviewId, reviewId) as { lastTerm: number | null; maxSeq: number | null };
      if (seqs.lastTerm !== null && seqs.lastTerm === seqs.maxSeq) {
        return;
      }
    }
    const phase =
      typeof extra.phase === 'string' && extra.phase.length > 0 ? extra.phase : this.currentPhaseOf(reviewId);
    insertEvent(this.db, {
      reviewId,
      kind: 'run_terminal',
      phase,
      payload: { outcome, ...extra, phase },
    });
  }

  private currentPhaseOf(reviewId: string): string {
    const row = this.client.sqlite.prepare('SELECT current_phase FROM reviews WHERE id = ?').get(reviewId) as
      | { current_phase: string | null }
      | undefined;
    return row?.current_phase ?? 'phase_8';
  }

  private shouldStop(reviewId: string): StopSignal {
    if (this.cancelRequested.has(reviewId)) {
      return 'cancel';
    }
    if (this.pauseRequested.has(reviewId)) {
      return 'pause';
    }
    if (this.stopping) {
      return 'shutdown';
    }
    if (this.leaseLost()) {
      this.log(`lease lost to another worker; stopping ${reviewId} at the next phase boundary`);
      return 'shutdown';
    }
    return null;
  }

  private leaseLost(): boolean {
    const current = readSetting<WorkerLease>(this.db, WORKER_LEASE_KEY);
    if (current === undefined || current.workerId === this.workerId) {
      return false;
    }
    const age = this.now() - Date.parse(current.heartbeatAt);
    return Number.isFinite(age) && age < this.staleLeaseMs;
  }

  private ingestComplete(reviewId: string): boolean {
    const row = this.client.sqlite
      .prepare("SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = 'phase_1'")
      .get(reviewId) as { status: string } | undefined;
    return row?.status === 'completed';
  }

  scanAwaitingInputTimeouts(): void {
    const nowMs = this.now();
    const rows = this.db
      .select({ id: reviews.id, updatedAt: reviews.updatedAt })
      .from(reviews)
      .where(eq(reviews.status, 'awaiting_input'))
      .all();
    if (rows.length === 0) {
      return;
    }
    const pending = new Set(
      this.db.select({ reviewId: runCommands.reviewId }).from(runCommands).all().map((command) => command.reviewId),
    );
    for (const row of rows) {
      if (pending.has(row.id)) {
        continue;
      }
      const age = nowMs - Date.parse(row.updatedAt);
      if (Number.isFinite(age) && age >= this.awaitingInputTimeoutMs) {
        pauseReview(this.db, row.id, { reason: 'awaiting_input_timeout' });
        this.intents.delete(row.id);
        this.log(`review ${row.id} paused: awaiting_input timeout`);
      }
    }
  }

  async tick(): Promise<void> {
    if (!this.ensureLease()) {
      return;
    }
    this.pollCommands();
    this.scanAwaitingInputTimeouts();
    this.markQueued();
    if (this.activeReviewId === null && this.processing === null) {
      const next = this.pickNext();
      if (next !== null) {
        this.processing = this.processReview(next)
          .catch((error) => {
            this.log(`review ${next} escaped its error handling: ${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => {
            this.processing = null;
          });
      }
    }
  }

  async runOnce(): Promise<void> {
    if (!this.ensureLease()) {
      return;
    }
    this.pollCommands();
    this.scanAwaitingInputTimeouts();
    if (this.activeReviewId === null) {
      const next = this.pickNext();
      if (next !== null) {
        await this.processReview(next);
      }
    }
  }

  async settle(): Promise<void> {
    if (this.processing !== null) {
      await this.processing;
    }
  }

  get idle(): boolean {
    return this.activeReviewId === null && this.processing === null;
  }

  recover(): void {
    const rows = this.db.select().from(reviews).all();
    const ts = new Date().toISOString();
    for (const row of rows) {
      const pendingWipe = this.pendingInvalidateFrom(row.optionsJson);
      if (pendingWipe !== null) {
        try {
          this.invalidateFilesFromPhase(row.id, pendingWipe);
          mergeReviewOptions(this.db, row.id, { pendingInvalidateFrom: null });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log(`review ${row.id}: artefact invalidation incomplete, will retry on next recovery: ${message}`);
        }
      }
      if (row.status === 'running' || row.status === 'sanitizing') {
        this.intents.set(row.id, { kind: 'run', args: this.recoveredArgs(row.id), createdAt: row.createdAt ?? ts, recovered: true });
      } else if (row.status === 'queued') {
        const resume = this.pendingResume(row.optionsJson);
        if (resume !== undefined) {
          this.intents.set(row.id, {
            kind: 'resume',
            args: {},
            answers: resume.answers,
            ...(resume.preset !== undefined ? { preset: resume.preset } : {}),
            createdAt: row.createdAt ?? ts,
            recovered: true,
          });
        } else {
          this.intents.set(row.id, { kind: 'run', args: this.recoveredArgs(row.id), createdAt: row.createdAt ?? ts, recovered: true });
        }
      }
    }
    this.recovered = true;
  }

  private recoveredArgs(reviewId: string): Record<string, unknown> {
    const row = this.db
      .select({ blobPath: manuscripts.blobPath, originalFilename: manuscripts.originalFilename, mimeType: manuscripts.mimeType })
      .from(manuscripts)
      .where(eq(manuscripts.reviewId, reviewId))
      .limit(1)
      .all()[0];
    if (row === undefined) {
      return {};
    }
    return { filePath: row.blobPath, originalFilename: row.originalFilename, mimeType: row.mimeType };
  }

  start(): void {
    writeHeartbeat();
    if (!this.ensureLease()) {
      this.log('another worker holds the lease; standing by until it goes stale');
    }
    this.loopTimer = setInterval(() => {
      writeHeartbeat();
      void this.tick();
    }, this.pollMs);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.processing !== null) {
      await this.processing;
    }
  }
}

function safeArgs(argsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}
