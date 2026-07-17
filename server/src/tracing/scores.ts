import { generateUUID, LangfuseAPIClient, type ScoreDataType } from '@langfuse/core';
import type { EnvSource } from '../providers/env';
import { activeTraceId } from './hierarchy';
import { readLangfuseConfig } from './langfuse';

export interface RunScore {
  name: string;
  value: number | string;
  dataType: ScoreDataType;
  comment?: string;
}

export interface ScoreClient {
  ingestion: { batch: (request: { batch: unknown[] }) => Promise<unknown> };
}

let cachedClient: ScoreClient | null = null;
let clientResolved = false;
let overrideClient: ScoreClient | null = null;

export function setScoreClientForTest(client: ScoreClient | null): void {
  overrideClient = client;
  clientResolved = false;
  cachedClient = null;
}

function resolveClient(env: EnvSource): ScoreClient | null {
  if (overrideClient !== null) {
    return overrideClient;
  }
  if (clientResolved) {
    return cachedClient;
  }
  clientResolved = true;
  const config = readLangfuseConfig(env);
  if (config === null) {
    cachedClient = null;
    return null;
  }
  cachedClient = new LangfuseAPIClient({
    environment: config.host,
    baseUrl: config.host,
    username: config.publicKey,
    password: config.secretKey,
  }) as unknown as ScoreClient;
  return cachedClient;
}

export function recordRunScores(scores: RunScore[], options: { env?: EnvSource } = {}): void {
  if (scores.length === 0) {
    return;
  }
  const traceId = activeTraceId();
  if (traceId === null) {
    return;
  }
  const client = resolveClient(options.env ?? process.env);
  if (client === null) {
    return;
  }
  const batch = scores.map((score) => ({
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    type: 'score-create' as const,
    body: {
      traceId,
      name: score.name,
      value: score.value,
      dataType: score.dataType,
      ...(score.comment !== undefined ? { comment: score.comment } : {}),
    },
  }));
  void Promise.resolve(client.ingestion.batch({ batch })).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`langfuse score export failed, run continues without scores: ${message}\n`);
  });
}
