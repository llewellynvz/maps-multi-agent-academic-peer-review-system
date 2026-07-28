import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { ApiError } from '../data/errors';

export interface SealedKey {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
  dekIv: Buffer;
  dekAuthTag: Buffer;
}

function masterKey(): Buffer {
  const raw = process.env.MARA_MASTER_KEY;
  if (raw === undefined || raw === '') {
    throw new ApiError(
      'master_key_missing',
      'A master key is required to store a provider key on disk. Set MARA_MASTER_KEY or add the key with session persistence.',
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }
  return scryptSync(raw, 'mara-master-key-derivation', 32);
}

export function sealKey(plaintext: string): SealedKey {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const dekIv = randomBytes(12);
  const wrapper = createCipheriv('aes-256-gcm', masterKey(), dekIv);
  const wrappedDek = Buffer.concat([wrapper.update(dek), wrapper.final()]);
  const dekAuthTag = wrapper.getAuthTag();

  return { ciphertext, iv, authTag, wrappedDek, dekIv, dekAuthTag };
}

export function openKey(sealed: SealedKey): string {
  const unwrap = createDecipheriv('aes-256-gcm', masterKey(), sealed.dekIv);
  unwrap.setAuthTag(sealed.dekAuthTag);
  const dek = Buffer.concat([unwrap.update(sealed.wrappedDek), unwrap.final()]);

  const decipher = createDecipheriv('aes-256-gcm', dek, sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}

export function maskKey(plaintext: string): string {
  if (plaintext.length <= 8) {
    return '****';
  }
  return `****${plaintext.slice(-4)}`;
}
