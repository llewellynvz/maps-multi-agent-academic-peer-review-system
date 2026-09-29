import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { providerKeys } from '../db/schema';
import { nowIso } from './db';
import { maskKey, openKey, sealKey } from './crypto';
import { ApiError } from './errors';
import type { ProviderKeyView } from './types';

const PROVIDERS = new Set(['anthropic', 'openai', 'google', 'local']);

const STORED_KEY_MASK = '****';

export function listKeys(db: MaraDatabase): ProviderKeyView[] {
  return db
    .select()
    .from(providerKeys)
    .all()
    .map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      maskedKey: STORED_KEY_MASK,
      baseUrl: row.baseUrl,
      persist: 'disk' as const,
    }));
}

export interface AddKeyInput {
  provider: string;
  label?: string | null;
  apiKey: string;
  baseUrl?: string | null;
  persist: 'disk' | 'session';
}

export function addKey(db: MaraDatabase, input: AddKeyInput): ProviderKeyView {
  if (!PROVIDERS.has(input.provider)) {
    throw new ApiError('unprocessable', 'Unknown provider.', { field: 'provider' });
  }
  if (input.apiKey.trim() === '') {
    throw new ApiError('unprocessable', 'An API key is required.', { field: 'apiKey' });
  }

  // A session key would live only in this web process's memory. The review worker is a separate process
  // and could never read it, so accepting one would report success for a key no review can use.
  if (input.persist === 'session') {
    throw new ApiError(
      'unprocessable',
      'Session-only keys are not visible to the review worker. Save the key to disk (this needs MARA_MASTER_KEY), or set it in .env.',
      { field: 'persist' },
    );
  }
  const sealed = sealKey(input.apiKey);
  const id = randomUUID();
  const ts = nowIso();
  db.insert(providerKeys)
    .values({
      id,
      provider: input.provider,
      label: input.label ?? null,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      wrappedDek: sealed.wrappedDek,
      dekIv: sealed.dekIv,
      dekAuthTag: sealed.dekAuthTag,
      baseUrl: input.baseUrl ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return {
    id,
    provider: input.provider,
    label: input.label ?? null,
    maskedKey: maskKey(input.apiKey),
    baseUrl: input.baseUrl ?? null,
    persist: 'disk',
  };
}

function asBuffer(value: unknown): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
}

const PROVIDER_ENV_VAR: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

// Providers read their credentials from the environment. Without this, a key added through the UI is
// sealed to disk or held in memory and never consulted, so the pipeline still fails on a missing env var.
// Environment values win: a deployment's own configuration is never overridden by a stored key.
// The newest stored key wins, so adding a corrected or rotated key takes effect without first
// deleting the one it replaces.
// Changes whenever a key is added, rotated or deleted, without decrypting anything.
export function providerKeysFingerprint(db: MaraDatabase): string {
  const row = db.get(sql`SELECT count(*) AS n, coalesce(max(created_at), '') AS latest, coalesce(group_concat(id), '') AS ids FROM provider_keys`) as
    | { n: number; latest: string; ids: string }
    | undefined;
  return row === undefined ? '' : `${row.n}:${row.latest}:${row.ids}`;
}

export function providerKeyEnv(db: MaraDatabase): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const row of db.select().from(providerKeys).orderBy(desc(providerKeys.createdAt), sql`rowid desc`).all()) {
    const name = PROVIDER_ENV_VAR[row.provider];
    if (name === undefined || resolved[name] !== undefined) {
      continue;
    }
    try {
      resolved[name] = openKey({
        ciphertext: asBuffer(row.ciphertext),
        iv: asBuffer(row.iv),
        authTag: asBuffer(row.authTag),
        wrappedDek: asBuffer(row.wrappedDek),
        dekIv: asBuffer(row.dekIv),
        dekAuthTag: asBuffer(row.dekAuthTag),
      });
    } catch {
      continue;
    }
  }
  return resolved;
}

// .env.example ships the provider keys as empty strings, so a copied .env puts '' in process.env for
// every one of them. A plain spread would let that empty string shadow a stored key and reinstate the
// missing-credential failure, so an environment entry only wins when it actually carries a value.
export function mergeProviderKeyEnv(
  env: Record<string, string | undefined>,
  stored: Record<string, string>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...env };
  for (const [name, value] of Object.entries(stored)) {
    if ((env[name] ?? '').trim() === '') {
      merged[name] = value;
    }
  }
  return merged;
}

export function deleteKey(db: MaraDatabase, id: string): void {
  const existing = db.select().from(providerKeys).where(eq(providerKeys.id, id)).limit(1).all()[0];
  if (existing === undefined) {
    throw new ApiError('not_found', `No provider key with id ${id}.`);
  }
  db.delete(providerKeys).where(eq(providerKeys.id, id)).run();
}
