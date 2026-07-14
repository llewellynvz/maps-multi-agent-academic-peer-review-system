import { asc, eq } from 'drizzle-orm';
import type { MaraClient, MaraDatabase } from '../db/client';
import { reviewEvents, reviews, runCommands } from '../db/schema';
import { insertEvent, updateReview } from '../workflow/repo';
import { writeHeartbeat } from '../data/heartbeat';
import type { StopSignal } from './supervisor';

export type IngestOutcome = 'suspended' | 'ingested' | 'halted';
export type EngineResult = 'completed' | 'paused' | 'cancelled' | 'stopped' | 'failed';

export interface WorkerProcessors {
  startIngest: (reviewId: string, args: Record<string, unknown>) => Promise<IngestOutcome>;
  resumeIngest: (reviewId: string, answers: Record<string, string>, preset: string | undefined) => Promise<IngestOutcome>;
  runEngine: (reviewId: string, shouldStop: () => StopSignal) => Promise<EngineResult>;
}

interface Intent {
  kind: 'ingest' | 'resume' | 'run';
  args: Record<string, unknown>;
  answers?: Record<string, string>;
  preset?: string;
  createdAt: string;
}

export interface WorkerRunnerOptions {
  client: MaraClient;
  processors: WorkerProcessors;
  pollMs?: number;
  onLog?: (message: string) => void;
}

export class WorkerRunner {
  private readonly client: MaraClient;
  private readonly db: MaraDatabase;
  private readonly processors: WorkerProcessors;
  private readonly pollMs: number;
  private readonly log: (message: string) => void;

  private activeReviewId: string | null = null;
  private readonly intents = new Map<string, Intent>();
  private readonly pauseRequested = new Set<string>();
  private readonly cancelRequested = new Set<string>();
  private readonly ackedCommands = new Set<string>();
  private ackedLoaded = false;
  private stopping = false;
  private processing: Promise<void> | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WorkerRunnerOptions) {
    this.client = options.client;
    this.db = options.client.db;
    this.processors = options.processors;
    this.pollMs = options.pollMs ?? 500;
    this.log = options.onLog ?? (() => undefined);
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
      this.applyCommand(command.reviewId, command.command, args, command.createdAt);
      insertEvent(this.db, {
        reviewId: command.reviewId,
        kind: 'control_ack',
        payload: { commandId: command.id, command: command.command },
      });
      this.ackedCommands.add(command.id);
      this.log(`command ${command.command} for ${command.reviewId}`);
    }
  }

  private applyCommand(reviewId: string, command: string, args: Record<string, unknown>, createdAt: string): void {
    switch (command) {
      case 'run': {
        const kind = args.trigger === 'ingest' ? 'ingest' : 'run';
        this.cancelRequested.delete(reviewId);
        this.pauseRequested.delete(reviewId);
        this.intents.set(reviewId, { kind, args, createdAt });
        break;
      }
      case 'resume': {
        this.cancelRequested.delete(reviewId);
        this.pauseRequested.delete(reviewId);
        this.intents.set(reviewId, {
          kind: 'resume',
          args,
          answers: (args.answers as Record<string, string> | undefined) ?? {},
          preset: typeof args.preset === 'string' ? args.preset : undefined,
          createdAt,
        });
        break;
      }
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

  pickNext(): string | null {
    if (this.activeReviewId !== null) {
      return null;
    }
    let best: { reviewId: string; createdAt: string } | null = null;
    for (const [reviewId, intent] of this.intents) {
      if (this.cancelRequested.has(reviewId)) {
        continue;
      }
      if (best === null || intent.createdAt < best.createdAt) {
        best = { reviewId, createdAt: intent.createdAt };
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
      if (row !== undefined && ['created', 'awaiting_input', 'paused'].includes(row.status)) {
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
        const outcome =
          intent.kind === 'resume'
            ? await this.processors.resumeIngest(reviewId, intent.answers ?? {}, intent.preset)
            : await this.processors.startIngest(reviewId, intent.args);
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
      this.emitTerminal(reviewId, 'complete', {
        recommendation: review?.recommendation ?? null,
        durationMs,
      });
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
    return null;
  }

  private ingestComplete(reviewId: string): boolean {
    const row = this.client.sqlite
      .prepare("SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = 'phase_1'")
      .get(reviewId) as { status: string } | undefined;
    return row?.status === 'completed';
  }

  async tick(): Promise<void> {
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
      if (row.status === 'running' || row.status === 'sanitizing' || row.status === 'queued') {
        this.intents.set(row.id, { kind: 'run', args: {}, createdAt: row.createdAt ?? ts });
      }
    }
  }

  start(): void {
    writeHeartbeat();
    this.recover();
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
