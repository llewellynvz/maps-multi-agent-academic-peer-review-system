import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { MaraClient, MaraDatabase } from '../db/client';
import { manuscripts, reviewEvents, reviews, runCommands } from '../db/schema';
import { getReviewOptions, insertEvent, mergeReviewOptions, updateReview } from '../workflow/repo';
import { readSetting, writeSetting } from '../data/settings-store';
import { writeHeartbeat } from '../data/heartbeat';
import type { StopSignal } from './supervisor';

export type IngestOutcome = 'suspended' | 'ingested' | 'halted';
export type EngineResult = 'completed' | 'paused' | 'cancelled' | 'stopped' | 'failed';

const WORKER_LEASE_KEY = 'worker_lease';
const QUEUEABLE_STATUSES = new Set(['created', 'awaiting_input', 'paused']);
const RESUMABLE_STATUSES = new Set(['awaiting_input', 'paused']);

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
      if (command.command === 'run' || command.command === 'resume') {
        try {
          this.db.transaction(
            (tx) => {
              this.applyDurable(tx, command.reviewId, command.command, args);
              insertEvent(tx, {
                reviewId: command.reviewId,
                kind: 'control_ack',
                payload: { commandId: command.id, command: command.command },
              });
              tx.delete(runCommands).where(eq(runCommands.id, command.id)).run();
            },
            { behavior: 'immediate' },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log(`could not apply ${command.command} for ${command.reviewId}: ${message}`);
          continue;
        }
        this.applyMemory(command.reviewId, command.command, args, command.createdAt);
      } else {
        this.applyCommand(command.reviewId, command.command, args, command.createdAt);
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

  private applyCommand(reviewId: string, command: string, args: Record<string, unknown>, createdAt: string): void {
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
      case 'retry_phase': {
        const phase = typeof args.phase === 'string' ? args.phase : '';
        if (phase !== '') {
          this.resetPhaseCheckpoint(reviewId, phase);
          this.intents.set(reviewId, { kind: 'run', args: {}, createdAt });
        }
        break;
      }
      default:
        break;
    }
  }

  private resetPhaseCheckpoint(reviewId: string, phase: string): void {
    const key = phase.startsWith('engine_') ? phase : `engine_${phase}`;
    this.client.sqlite
      .prepare("UPDATE phase_checkpoints SET status = 'pending', updated_at = ? WHERE review_id = ? AND phase = ?")
      .run(new Date().toISOString(), reviewId, key);
  }

  private clearPendingResume(reviewId: string): void {
    const options = getReviewOptions(this.db, reviewId);
    if (options.pendingResume !== undefined && options.pendingResume !== null) {
      mergeReviewOptions(this.db, reviewId, { pendingResume: null });
    }
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
    const intent = this.intents.get(reviewId) ?? { kind: 'run', args: {}, createdAt: new Date().toISOString() };
    this.intents.delete(reviewId);
    this.activeReviewId = reviewId;
    const startedMs = Date.now();

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
      this.finishEngine(reviewId, result, durationMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.shouldStop(reviewId) === 'shutdown') {
        this.log(`review ${reviewId} interrupted after losing the worker slot: ${message}`);
        return;
      }
      updateReview(this.db, reviewId, { status: 'failed', errorClass: 'engine_error' });
      this.emitTerminal(reviewId, 'failed', { errorClass: 'engine_error', message });
      this.log(`review ${reviewId} failed: ${message}`);
    } finally {
      this.pauseRequested.delete(reviewId);
      this.activeReviewId = null;
    }
  }

  private finishEngine(reviewId: string, result: EngineResult, durationMs: number): void {
    if (result === 'completed') {
      const review = this.db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0];
      if (review?.status === 'completed') {
        this.emitTerminal(reviewId, 'complete', {
          recommendation: review.recommendation ?? null,
          durationMs,
        });
        return;
      }
      const errorClass = review?.errorClass ?? 'not_released';
      updateReview(this.db, reviewId, { status: 'failed', errorClass });
      this.emitTerminal(reviewId, 'failed', { errorClass, durationMs });
    } else if (result === 'paused') {
      this.pauseRequested.delete(reviewId);
      updateReview(this.db, reviewId, { status: 'paused' });
    } else if (result === 'cancelled') {
      updateReview(this.db, reviewId, { status: 'cancelled' });
      this.emitTerminal(reviewId, 'cancelled', {});
    } else if (result === 'failed') {
      this.emitTerminal(reviewId, 'failed', { errorClass: 'engine_error' });
    }
  }

  private emitTerminal(reviewId: string, outcome: string, extra: Record<string, unknown>): void {
    const existing = this.client.sqlite
      .prepare("SELECT count(*) AS n FROM review_events WHERE review_id = ? AND kind = 'run_terminal'")
      .get(reviewId) as { n: number };
    if (existing.n > 0) {
      return;
    }
    insertEvent(this.db, {
      reviewId,
      kind: 'run_terminal',
      phase: 'phase_8',
      payload: { outcome, ...extra },
    });
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

  async tick(): Promise<void> {
    if (!this.ensureLease()) {
      return;
    }
    this.pollCommands();
    this.markQueued();
    if (this.activeReviewId === null && this.processing === null) {
      const next = this.pickNext();
      if (next !== null) {
        this.processing = this.processReview(next).finally(() => {
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
