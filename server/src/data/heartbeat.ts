import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataDir } from '../paths';

const STALE_MS = 12_000;

function heartbeatPath(): string {
  return resolve(dataDir(), 'worker-heartbeat.txt');
}

export function writeHeartbeat(): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(heartbeatPath(), new Date().toISOString(), 'utf8');
}

export function workerIsUp(): boolean {
  const path = heartbeatPath();
  if (!existsSync(path)) {
    return false;
  }
  try {
    const last = new Date(readFileSync(path, 'utf8').trim()).getTime();
    return Number.isFinite(last) && Date.now() - last < STALE_MS;
  } catch {
    return false;
  }
}
