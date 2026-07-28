import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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

const sessionKeys = new Map<string, { provider: string; label: string | null; apiKey: string; baseUrl: string | null }>();

export function addKey(db: MaraDatabase, input: AddKeyInput): ProviderKeyView {
  if (!PROVIDERS.has(input.provider)) {
    throw new ApiError('unprocessable', 'Unknown provider.', { field: 'provider' });
  }
  if (input.apiKey.trim() === '') {
    throw new ApiError('unprocessable', 'An API key is required.', { field: 'apiKey' });
  }

  if (input.persist === 'session') {
    const id = randomUUID();
    sessionKeys.set(id, {
      provider: input.provider,
      label: input.label ?? null,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl ?? null,
    });
    return {
      id,
      provider: input.provider,
      label: input.label ?? null,
      maskedKey: maskKey(input.apiKey),
      baseUrl: input.baseUrl ?? null,
      persist: 'session',
    };
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
export function providerKeyEnv(db: MaraDatabase): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [id, entry] of sessionKeys) {
    void id;
    const name = PROVIDER_ENV_VAR[entry.provider];
    if (name !== undefined && resolved[name] === undefined) {
      resolved[name] = entry.apiKey;
    }
  }
  for (const row of db.select().from(providerKeys).all()) {
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
  if (sessionKeys.delete(id)) {
    return;
  }
  const existing = db.select().from(providerKeys).where(eq(providerKeys.id, id)).limit(1).all()[0];
  if (existing === undefined) {
    throw new ApiError('not_found', `No provider key with id ${id}.`);
  }
  db.delete(providerKeys).where(eq(providerKeys.id, id)).run();
}
