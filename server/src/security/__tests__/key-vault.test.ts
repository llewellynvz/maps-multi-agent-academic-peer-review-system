import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openKey, sealKey } from '../vault';

describe('key vault suite (SEC-13/14/16/17, SEC-30)', () => {
  const original = process.env.MARA_MASTER_KEY;

  beforeEach(() => {
    process.env.MARA_MASTER_KEY = '0'.repeat(64);
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.MARA_MASTER_KEY;
    } else {
      process.env.MARA_MASTER_KEY = original;
    }
  });

  it('round-trips a known key through the envelope and returns the original', () => {
    const secret = 'sk-live-A1b2C3d4E5f6G7h8';
    const sealed = sealKey(secret);
    expect(openKey(sealed)).toBe(secret);
  });

  it('never leaves the plaintext inside the stored ciphertext', () => {
    const secret = 'sk-live-do-not-store-plaintext';
    const sealed = sealKey(secret);
    expect(sealed.ciphertext.toString('utf8')).not.toContain(secret);
    expect(sealed.ciphertext.toString('latin1')).not.toContain(secret);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.authTag).toHaveLength(16);
    expect(sealed.dekIv).toHaveLength(12);
    expect(sealed.dekAuthTag).toHaveLength(16);
  });

  it('fails closed under a wrong master key rather than returning corrupt plaintext', () => {
    const sealed = sealKey('sk-live-secret');
    process.env.MARA_MASTER_KEY = '1'.repeat(64);
    expect(() => openKey(sealed)).toThrow();
  });

  it('fails closed when the ciphertext authentication tag is tampered', () => {
    const sealed = sealKey('sk-live-secret');
    sealed.authTag[0] = (sealed.authTag[0] ?? 0) ^ 0xff;
    expect(() => openKey(sealed)).toThrow();
  });
});
