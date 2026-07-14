import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDb, type MaraClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import { maraDbPath } from '../paths';

let cached: MaraClient | null = null;

function resolveDbPath(): string {
  const override = process.env.MARA_DB_PATH;
  return override !== undefined && override !== '' ? override : maraDbPath();
}

export function getClient(): MaraClient {
  if (cached !== null) {
    return cached;
  }
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const client = createDb(path);
  runMigrations(client.db);
  cached = client;
  return client;
}

export function resetClient(): void {
  if (cached !== null) {
    cached.sqlite.close();
    cached = null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
