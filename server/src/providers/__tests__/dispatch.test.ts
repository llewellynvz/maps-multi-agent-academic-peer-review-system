import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { writeSetting } from '../../data/settings-store';
import { createDispatchRunner, type GenerateApi } from '../dispatch';
import type { Registry } from '../registry';
import type { ModelRef } from '../types';

let tempDir: string;
let sqlite: SqliteConnection;
let db: MaraDatabase;

const stubRegistry: Registry = {
  resolveModel: () => {
    throw new Error('resolveModel should not be called in these tests');
  },
  resolveRole: () => {
    throw new Error('resolveRole should not be called when a model is supplied');
  },
};

const modelRef: ModelRef = {
  providerName: 'azure',
  model: 'gpt-5.1',
  languageModel: {} as LanguageModel,
  isReasoning: true,
};

function countingGenerate(overrides?: Partial<GenerateApi>): {
  generate: GenerateApi;
  textCalls: () => number;
  objectCalls: () => number;
} {
  let textCalls = 0;
  let objectCalls = 0;
  const generate: GenerateApi = {
    generateText: async (options) => {
      textCalls += 1;
      if (overrides?.generateText) {
        return overrides.generateText(options);
      }
      return {
        text: 'model reply',
        usage: {
          inputTokens: 1200,
          outputTokens: 40,
          inputTokenDetails: { cacheReadTokens: 900 },
          outputTokenDetails: { reasoningTokens: 15 },
        },
      };
    },
    generateObject: async (options) => {
      objectCalls += 1;
      if (overrides?.generateObject) {
        return overrides.generateObject(options);
      }
      return { object: { verdict: 'ok' }, usage: { inputTokens: 300, outputTokens: 10 } };
    },
  };
  return { generate, textCalls: () => textCalls, objectCalls: () => objectCalls };
}

function insertReview(id: string): void {
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, id, now, now);
}

function baseInput(dispatchId?: string) {
  return {
    reviewId: 'rev-1',
    phase: 'phase_3',
    agent: 'specialist-stat',
    promptVersion: 'v1',
    model: modelRef,
    parts: { system: 'shared prefix', prompt: 'question' },
    dispatchId,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-dispatch-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  insertReview('rev-1');
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('dispatch runner', () => {
  it('persists a success row with extracted token counts', async () => {
    const { generate } = countingGenerate();
    const run = createDispatchRunner({ db, registry: stubRegistry, generate, now: () => 0 });

    const result = await run(baseInput());

    expect(result.status).toBe('success');
    expect(result.text).toBe('model reply');
    expect(result.tokens).toEqual({
      inputTokens: 1200,
      outputTokens: 40,
      cachedTokens: 900,
      reasoningTokens: 15,
    });
    expect(result.langfuseTraceId).toBeNull();

    const rows = sqlite.prepare('SELECT * FROM dispatches').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe('azure');
    expect(rows[0]?.model).toBe('gpt-5.1');
    expect(rows[0]?.tokens_cached).toBe(900);
    expect(rows[0]?.status).toBe('success');
    expect(rows[0]?.langfuse_trace_id).toBeNull();
  });

  it('skips the model call and replays a persisted dispatch for a repeated dispatch id', async () => {
    const first = countingGenerate();
    const run = createDispatchRunner({ db, registry: stubRegistry, generate: first.generate, now: () => 0 });

    const original = await run(baseInput('dispatch-key-1'));
    expect(original.replayed).toBe(false);

    const second = countingGenerate();
    const runAgain = createDispatchRunner({ db, registry: stubRegistry, generate: second.generate, now: () => 0 });
    const replay = await runAgain(baseInput('dispatch-key-1'));

    expect(replay.replayed).toBe(true);
    expect(replay.dispatchId).toBe('dispatch-key-1');
    expect(replay.tokens.inputTokens).toBe(1200);
    expect(second.textCalls()).toBe(0);

    const rows = sqlite.prepare("SELECT count(*) AS n FROM dispatches WHERE status = 'success'").get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('records an error row and rethrows without colliding on the dispatch id', async () => {
    const failing: GenerateApi = {
      generateText: async () => {
        const error = new Error('boom');
        error.name = 'ProviderError';
        throw error;
      },
      generateObject: async () => ({ object: {}, usage: {} }),
    };
    const run = createDispatchRunner({ db, registry: stubRegistry, generate: failing, now: () => 0 });

    await expect(run(baseInput('dispatch-key-2'))).rejects.toThrow('boom');

    const rows = sqlite.prepare('SELECT id, status, error_class FROM dispatches').all() as Array<{
      id: string;
      status: string;
      error_class: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('error');
    expect(rows[0]?.error_class).toBe('ProviderError');
    expect(rows[0]?.id).not.toBe('dispatch-key-2');
  });

  it('routes to generateObject when a schema is supplied', async () => {
    const { generate, textCalls, objectCalls } = countingGenerate();
    const run = createDispatchRunner({ db, registry: stubRegistry, generate, now: () => 0 });

    const result = await run({
      ...baseInput(),
      schema: z.object({ verdict: z.string() }),
    });

    expect(objectCalls()).toBe(1);
    expect(textCalls()).toBe(0);
    expect(result.object).toEqual({ verdict: 'ok' });
  });

  it('records prompt content in telemetry only when the telemetry setting is on', async () => {
    let captured: { experimental_telemetry?: { recordInputs: boolean; recordOutputs: boolean } } | undefined;
    const generate: GenerateApi = {
      generateText: async (options) => {
        captured = options;
        return { text: 'x', usage: { inputTokens: 1, outputTokens: 1 } };
      },
      generateObject: async () => {
        throw new Error('not used');
      },
    };
    const run = createDispatchRunner({ db, registry: stubRegistry, generate, now: () => 0 });

    await run(baseInput());
    expect(captured?.experimental_telemetry?.recordInputs).toBe(false);
    expect(captured?.experimental_telemetry?.recordOutputs).toBe(false);

    writeSetting(db, 'telemetry', true);
    await run(baseInput());
    expect(captured?.experimental_telemetry?.recordInputs).toBe(true);
    expect(captured?.experimental_telemetry?.recordOutputs).toBe(true);

    writeSetting(db, 'telemetry', false);
    await run(baseInput());
    expect(captured?.experimental_telemetry?.recordInputs).toBe(false);
  });

  it('drops temperature for a reasoning model but forwards it for a non-reasoning model', async () => {
    let captured: { temperature?: number } | undefined;
    const generate: GenerateApi = {
      generateText: async (options) => {
        captured = options;
        return { text: 'x', usage: {} };
      },
      generateObject: async (options) => {
        captured = options;
        return { object: {}, usage: {} };
      },
    };
    const run = createDispatchRunner({ db, registry: stubRegistry, generate, now: () => 0 });

    await run({ ...baseInput(), temperature: 0.5 });
    expect(captured?.temperature).toBeUndefined();

    const nonReasoning: ModelRef = {
      providerName: 'openai',
      model: 'gpt-4o-mini',
      languageModel: {} as LanguageModel,
      isReasoning: false,
    };
    await run({ ...baseInput(), model: nonReasoning, temperature: 0.5 });
    expect(captured?.temperature).toBe(0.5);
  });

  it('measures latency from the injected clock', async () => {
    const { generate } = countingGenerate();
    let clock = 100;
    const run = createDispatchRunner({
      db,
      registry: stubRegistry,
      generate,
      now: () => {
        const value = clock;
        clock += 250;
        return value;
      },
    });

    const result = await run(baseInput());
    expect(result.latencyMs).toBe(250);
  });
});
