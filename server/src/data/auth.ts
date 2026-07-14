import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { MaraDatabase } from '../db/client';
import { readSetting, writeSetting } from './settings-store';

interface PassphraseRecord {
  salt: string;
  hash: string;
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'mara_session';

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function passphraseRecord(db: MaraDatabase): PassphraseRecord | null {
  const record = readSetting<PassphraseRecord | null>(db, 'passphrase');
  if (record === undefined || record === null || typeof record !== 'object' || !('hash' in record)) {
    return null;
  }
  return record;
}

export function passphraseIsSet(db: MaraDatabase): boolean {
  return passphraseRecord(db) !== null;
}

export function setPassphrase(db: MaraDatabase, passphrase: string): void {
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase, salt, 64);
  writeSetting(db, 'passphrase', { salt: salt.toString('hex'), hash: hash.toString('hex') } satisfies PassphraseRecord);
}

export function clearPassphrase(db: MaraDatabase): void {
  writeSetting(db, 'passphrase', null);
}

export function verifyPassphrase(db: MaraDatabase, passphrase: string): boolean {
  const record = passphraseRecord(db);
  if (record === null) {
    return false;
  }
  const salt = Buffer.from(record.salt, 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  const actual = scryptSync(passphrase, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionSecret(db: MaraDatabase): Buffer {
  const existing = readSetting<string>(db, 'session_secret');
  if (typeof existing === 'string' && existing.length >= 32) {
    return Buffer.from(existing, 'hex');
  }
  const secret = randomBytes(32);
  writeSetting(db, 'session_secret', secret.toString('hex'));
  return secret;
}

export interface IssuedToken {
  token: string;
  expiresAt: string;
}

export function issueToken(db: MaraDatabase, ttlMs: number = TOKEN_TTL_MS): IssuedToken {
  const exp = Date.now() + ttlMs;
  const payload = base64url(Buffer.from(JSON.stringify({ exp }), 'utf8'));
  const signature = base64url(createHmac('sha256', sessionSecret(db)).update(payload).digest());
  return { token: `${payload}.${signature}`, expiresAt: new Date(exp).toISOString() };
}

export function accessDenied(db: MaraDatabase, token: string | undefined | null): boolean {
  if (!passphraseIsSet(db)) {
    return false;
  }
  return !verifyToken(db, token);
}

export function verifyToken(db: MaraDatabase, token: string | undefined | null): boolean {
  if (token === undefined || token === null || token === '') {
    return false;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [payload, signature] = parts as [string, string];
  const expected = base64url(createHmac('sha256', sessionSecret(db)).update(payload).digest());
  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return false;
  }
  try {
    const decoded = JSON.parse(fromBase64url(payload).toString('utf8')) as { exp?: number };
    return typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
}
