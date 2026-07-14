import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const actualRepoRoot = resolve(testDir, '..', '..', '..', '..');
const originalRoot = process.env.MARA_ROOT_DIR;

afterEach(() => {
  if (originalRoot === undefined) {
    delete process.env.MARA_ROOT_DIR;
  } else {
    process.env.MARA_ROOT_DIR = originalRoot;
  }
  vi.resetModules();
});

describe('container path overrides', () => {
  it('MARA_ROOT_DIR relocates repoRoot and every derived data path', async () => {
    const fakeRoot = join(tmpdir(), 'mara-root-fixture');
    process.env.MARA_ROOT_DIR = fakeRoot;
    vi.resetModules();
    const paths = await import('../../paths');
    expect(paths.repoRoot).toBe(resolve(fakeRoot));
    expect(paths.dataDir()).toBe(resolve(fakeRoot, 'data'));
    expect(paths.maraDbPath()).toBe(resolve(fakeRoot, 'data', 'mara.db'));
    expect(paths.mastraDbPath()).toBe(resolve(fakeRoot, 'data', 'mastra.db'));
    expect(paths.blobDir('r1')).toBe(resolve(fakeRoot, 'data', 'blobs', 'r1'));
  });

  it('falls back to the source-relative repo root when unset', async () => {
    delete process.env.MARA_ROOT_DIR;
    vi.resetModules();
    const paths = await import('../../paths');
    expect(paths.repoRoot).toBe(actualRepoRoot);
    expect(paths.dataDir()).toBe(resolve(actualRepoRoot, 'data'));
  });

  it('runMigrations resolves the drizzle folder under repoRoot', async () => {
    process.env.MARA_ROOT_DIR = actualRepoRoot;
    vi.resetModules();
    const { createDb } = await import('../client');
    const { runMigrations } = await import('../migrate');
    const dir = mkdtempSync(join(tmpdir(), 'mara-migrate-'));
    const { db, sqlite } = createDb(join(dir, 'm.db'));
    runMigrations(db);
    const table = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reviews'")
      .all();
    expect(table.length).toBe(1);
    sqlite.close();
  });
});
