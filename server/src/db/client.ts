import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Schema = typeof schema;
export type MaraDatabase = BetterSQLite3Database<Schema>;
export type SqliteConnection = DatabaseConstructor.Database;

export const defaultDatabasePath = resolve(process.cwd(), 'data', 'mara.db');

export function openSqlite(databasePath: string): SqliteConnection {
  const connection = new DatabaseConstructor(databasePath);
  connection.pragma('journal_mode = WAL');
  connection.pragma('busy_timeout = 5000');
  connection.pragma('foreign_keys = ON');
  return connection;
}

export interface MaraClient {
  db: MaraDatabase;
  sqlite: SqliteConnection;
}

export function createDb(databasePath: string): MaraClient {
  const sqlite = openSqlite(databasePath);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function createDefaultClient(): MaraClient {
  mkdirSync(dirname(defaultDatabasePath), { recursive: true });
  return createDb(defaultDatabasePath);
}
