import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDefaultClient, type MaraDatabase } from './client';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export function runMigrations(db: MaraDatabase): void {
  migrate(db, { migrationsFolder });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const { db } = createDefaultClient();
  runMigrations(db);
}
