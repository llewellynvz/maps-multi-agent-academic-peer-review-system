import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { providerKeys } from '../db/schema';
import { nowIso } from './db';
import { maskKey, openKey, sealKey } from './crypto';
import { ApiError } from './errors';
import type { ProviderKeyView } from './types';

const PROVIDERS = new Set(['anthropic', 'openai', 'google', 'local']);

function maskFor(row: typeof providerKeys.$inferSelect): string {
  try {
    return maskKey(
      openKey({
        ciphertext: row.ciphertext as Buffer,
        iv: row.iv as Buffer,
        authTag: row.authTag as Buffer,
        wrappedDek: row.wrappedDek as Buffer,
        dekIv: row.dekIv as Buffer,
        dekAuthTag: row.dekAuthTag as Buffer,
      }),
    );
  } catch {
    return '****';
  }
}

export function listKeys(db: MaraDatabase): ProviderKeyView[] {
  return db
    .select()
    .from(providerKeys)
    .all()
    .map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      maskedKey: maskFor(row),
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
