import { eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { settings } from '../db/schema';
import { nowIso } from './db';

export function readSetting<T>(db: MaraDatabase, key: string): T | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).limit(1).all()[0];
  if (row === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return undefined;
  }
}

export function writeSetting(db: MaraDatabase, key: string, value: unknown): void {
  const valueJson = JSON.stringify(value);
  const existing = db.select().from(settings).where(eq(settings.key, key)).limit(1).all()[0];
  if (existing !== undefined) {
    db.update(settings).set({ valueJson, updatedAt: nowIso() }).where(eq(settings.key, key)).run();
    return;
  }
  db.insert(settings).values({ key, valueJson, updatedAt: nowIso() }).run();
}

export function readAllSettings(db: MaraDatabase): Record<string, unknown> {
  const rows = db.select().from(settings).all();
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.valueJson);
    } catch {
      out[row.key] = null;
    }
  }
  return out;
}

export const SECRET_SETTING_KEYS = new Set(['passphrase', 'session_secret']);

export const COST_CEILING_SETTING_KEY = 'cost_ceiling_usd';
