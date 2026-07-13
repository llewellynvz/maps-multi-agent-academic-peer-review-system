import { isAbsolute, resolve } from 'node:path';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';
import { createGrobidClient, type GrobidClient } from '../../src/ingest';
import { dataDir, ensureDir, maraDbPath, mastraDbPath, repoRoot } from '../../src/paths';
import { createDispatchRunner, createRegistry, type DispatchRunner } from '../../src/providers';

export interface SliceBContext {
  db: MaraDatabase;
  sqlite: SqliteConnection;
  runDispatch: DispatchRunner;
  grobid: GrobidClient;
  grobidUrl: string;
  mastraDbPath: string;
}

export function loadSliceBEnv(): void {
  process.loadEnvFile(resolve(repoRoot, '.env'));
  const cert = process.env.AZURE_CLIENT_CERT_PEM_PATH;
  if (cert !== undefined && cert !== '' && !isAbsolute(cert)) {
    process.env.AZURE_CLIENT_CERT_PEM_PATH = resolve(repoRoot, cert);
  }
}

export function buildSliceBContext(): SliceBContext {
  loadSliceBEnv();
  ensureDir(dataDir());
  const { db, sqlite } = createDb(maraDbPath());
  runMigrations(db);
  const registry = createRegistry({ env: process.env });
  const runDispatch = createDispatchRunner({ db, registry });
  const grobidUrl = (process.env.GROBID_URL ?? 'http://127.0.0.1:8070').replace('localhost', '127.0.0.1');
  const grobid = createGrobidClient({ baseUrl: grobidUrl });
  return { db, sqlite, runDispatch, grobid, grobidUrl, mastraDbPath: mastraDbPath() };
}
