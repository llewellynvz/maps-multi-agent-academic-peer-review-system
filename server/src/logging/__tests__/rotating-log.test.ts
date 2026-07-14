import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalRoot = process.env.MARA_ROOT_DIR;
const originalMax = process.env.MARA_LOG_MAX_BYTES;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mara-log-'));
  process.env.MARA_ROOT_DIR = root;
  process.env.MARA_LOG_MAX_BYTES = '400';
  vi.resetModules();
});

afterEach(() => {
  if (originalRoot === undefined) delete process.env.MARA_ROOT_DIR;
  else process.env.MARA_ROOT_DIR = originalRoot;
  if (originalMax === undefined) delete process.env.MARA_LOG_MAX_BYTES;
  else process.env.MARA_LOG_MAX_BYTES = originalMax;
  vi.resetModules();
});

describe('createRotatingLog', () => {
  it('writes JSON lines under data/logs and redacts secret fields but keeps token counts', async () => {
    const { createRotatingLog } = await import('../rotating-log');
    const log = createRotatingLog('worker');
    log.write('info', 'worker', 'dispatch complete', {
      apiKey: 'sk-secret-value',
      authorization: 'Bearer abc',
      token: 'session-token-value',
      refresh_tokens: 'rt-secret',
      access_tokens: 'at-secret',
      credential: 'cred-value',
      cookie: 'session=abc',
      tokensIn: 1234,
      tokensOut: 78,
      tokensCached: 56,
      tokens_in: 90,
      provider: 'azure',
    });
    const file = resolve(root, 'data', 'logs', 'worker.log');
    expect(existsSync(file)).toBe(true);
    const line = JSON.parse(readFileSync(file, 'utf8').trim()) as Record<string, unknown>;
    expect(line.level).toBe('info');
    expect(line.component).toBe('worker');
    expect(line.msg).toBe('dispatch complete');
    expect(line.apiKey).toBe('[redacted]');
    expect(line.authorization).toBe('[redacted]');
    expect(line.token).toBe('[redacted]');
    expect(line.refresh_tokens).toBe('[redacted]');
    expect(line.access_tokens).toBe('[redacted]');
    expect(line.credential).toBe('[redacted]');
    expect(line.cookie).toBe('[redacted]');
    expect(line.tokensIn).toBe(1234);
    expect(line.tokensOut).toBe(78);
    expect(line.tokensCached).toBe(56);
    expect(line.tokens_in).toBe(90);
    expect(line.provider).toBe('azure');
  });

  it('rotates when the file exceeds the size cap', async () => {
    const { createRotatingLog } = await import('../rotating-log');
    const log = createRotatingLog('worker');
    for (let i = 0; i < 40; i += 1) {
      log.write('info', 'worker', `line number ${i} with enough padding to fill the small cap quickly`);
    }
    const base = resolve(root, 'data', 'logs', 'worker.log');
    expect(existsSync(base)).toBe(true);
    expect(existsSync(`${base}.1`)).toBe(true);
  });
});
