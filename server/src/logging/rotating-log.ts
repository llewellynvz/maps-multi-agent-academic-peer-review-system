import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataDir } from '../paths';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface RotatingLog {
  write(level: LogLevel, component: string, message: string, fields?: Record<string, unknown>): void;
}

const SECRET_KEY =
  /(api[_-]?key|secret|passphrase|password|master[_-]?key|wrapped[_-]?key|authorization|tokens?(?!s|[_-]?(?:in|out|cached))|credential|bearer|cookie|client[_-]?cert|_pem)/i;

const SECRET_ASSIGNMENT =
  /(api[_-]?key|secret|passphrase|password|master[_-]?key|wrapped[_-]?key|authorization|bearer|credential|token|cookie)(\s*[=:]\s*)(\S+)/gi;
const LONG_SECRET_TOKEN =
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9._-]{16,}\b|\b[A-Za-z0-9+/]{40,}={0,2}\b|\b[A-Fa-f0-9]{40,}\b/g;

function scrubString(value: string): string {
  return value.replace(SECRET_ASSIGNMENT, (_match, key, sep) => `${key}${sep}[redacted]`).replace(LONG_SECRET_TOKEN, '[redacted]');
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(entry);
    }
    return out;
  }
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createRotatingLog(name: string): RotatingLog {
  const dir = resolve(dataDir(), 'logs');
  const file = resolve(dir, `${name}.log`);
  const maxBytes = envInt('MARA_LOG_MAX_BYTES', 5 * 1024 * 1024);
  const maxFiles = envInt('MARA_LOG_MAX_FILES', 14);
  let ensured = false;

  function ensure(): void {
    if (!ensured) {
      mkdirSync(dir, { recursive: true });
      ensured = true;
    }
  }

  function rotate(): void {
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size < maxBytes) {
      return;
    }
    rmSync(`${file}.${maxFiles}`, { force: true });
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      try {
        renameSync(`${file}.${index}`, `${file}.${index + 1}`);
      } catch {
        /* rotated file absent */
      }
    }
    try {
      renameSync(file, `${file}.1`);
    } catch {
      /* nothing to rotate */
    }
  }

  return {
    write(level, component, message, fields) {
      try {
        ensure();
        rotate();
        const record: Record<string, unknown> = {
          ts: new Date().toISOString(),
          level,
          component,
          msg: scrubString(message),
        };
        if (fields !== undefined) {
          Object.assign(record, redact(fields) as Record<string, unknown>);
        }
        appendFileSync(file, `${JSON.stringify(record)}\n`);
      } catch {
        /* logging must never throw into the caller */
      }
    },
  };
}
