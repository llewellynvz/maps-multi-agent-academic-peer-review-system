import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, resetClient } from 'server/src/data';
import { GET as healthGET } from '@/app/api/health/route';
import { POST as sessionPOST } from '@/app/api/session/route';
import { GET as reviewsGET, POST as reviewsPOST } from '@/app/api/reviews/route';
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/settings/route';
import { GET as eventsGET } from '@/app/api/reviews/[id]/events/route';
import { POST as manuscriptPOST } from '@/app/api/reviews/[id]/manuscript/route';

let tempDir: string;

type NextInit = ConstructorParameters<typeof NextRequest>[1];

function req(url: string, init?: NextInit): NextRequest {
  return new NextRequest(`http://127.0.0.1${url}`, init);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-routes-'));
  process.env.MARA_DB_PATH = join(tempDir, 'mara.db');
  resetClient();
});

afterEach(() => {
  resetClient();
  delete process.env.MARA_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('health and reviews routes', () => {
  it('reports health and creates then lists a review', async () => {
    const health = await healthGET();
    const healthBody = (await health.json()) as { status: string; worker: string; db: string };
    expect(healthBody.status).toBe('ok');
    expect(healthBody.db).toBe('ok');

    const created = await reviewsPOST(req('/api/reviews', { method: 'POST', body: JSON.stringify({ title: 'My study' }) }));
    expect(created.status).toBe(201);
    const review = (await created.json()) as { id: string; title: string };
    expect(review.title).toBe('My study');

    const list = await reviewsGET(req('/api/reviews'));
    const listBody = (await list.json()) as { reviews: Array<{ id: string }> };
    expect(listBody.reviews.map((r) => r.id)).toContain(review.id);
  });
});

describe('passphrase gate (API-02/04)', () => {
  it('returns 401 before login, succeeds after, and reopens on clear', async () => {
    await settingsPUT(req('/api/settings', { method: 'PUT', body: JSON.stringify({ passphrase: 'letmein' }) }));

    const denied = await reviewsGET(req('/api/reviews'));
    expect(denied.status).toBe(401);

    const session = await sessionPOST(req('/api/session', { method: 'POST', body: JSON.stringify({ passphrase: 'letmein' }) }));
    expect(session.status).toBe(200);
    const { token } = (await session.json()) as { token: string };

    const allowed = await reviewsGET(req('/api/reviews', { headers: { authorization: `Bearer ${token}` } }));
    expect(allowed.status).toBe(200);

    const wrong = await sessionPOST(req('/api/session', { method: 'POST', body: JSON.stringify({ passphrase: 'nope' }) }));
    expect(wrong.status).toBe(401);

    await settingsPUT(req('/api/settings', { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ passphrase: null }) }));
    const reopened = await reviewsGET(req('/api/reviews'));
    expect(reopened.status).toBe(200);

    const settings = await settingsGET(req('/api/settings'));
    const settingsBody = (await settings.json()) as { passphraseSet: boolean };
    expect(settingsBody.passphraseSet).toBe(false);
  });
});

describe('session failed-attempt throttle', () => {
  it('locks out after five failures with a Retry-After, and a success resets the counter', async () => {
    await settingsPUT(req('/api/settings', { method: 'PUT', body: JSON.stringify({ passphrase: 'letmein' }) }));

    const attacker = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 5; i += 1) {
      const failed = await sessionPOST(req('/api/session', { method: 'POST', headers: attacker, body: JSON.stringify({ passphrase: 'wrong' }) }));
      expect(failed.status).toBe(401);
    }
    const locked = await sessionPOST(req('/api/session', { method: 'POST', headers: attacker, body: JSON.stringify({ passphrase: 'wrong' }) }));
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).not.toBeNull();

    const other = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 4; i += 1) {
      const failed = await sessionPOST(req('/api/session', { method: 'POST', headers: other, body: JSON.stringify({ passphrase: 'wrong' }) }));
      expect(failed.status).toBe(401);
    }
    const success = await sessionPOST(req('/api/session', { method: 'POST', headers: other, body: JSON.stringify({ passphrase: 'letmein' }) }));
    expect(success.status).toBe(200);
    const afterReset1 = await sessionPOST(req('/api/session', { method: 'POST', headers: other, body: JSON.stringify({ passphrase: 'wrong' }) }));
    const afterReset2 = await sessionPOST(req('/api/session', { method: 'POST', headers: other, body: JSON.stringify({ passphrase: 'wrong' }) }));
    expect(afterReset1.status).toBe(401);
    expect(afterReset2.status).toBe(401);
  });
  it('throttles guessing after a flood but lets the owner in once a check slot frees, instead of a 15-minute lockout', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
      await settingsPUT(req('/api/settings', { method: 'PUT', body: JSON.stringify({ passphrase: 'letmein' }) }));
      for (let i = 0; i < 25; i += 1) {
        const headers = { 'x-forwarded-for': `198.51.100.${i}` };
        await sessionPOST(req('/api/session', { method: 'POST', headers, body: JSON.stringify({ passphrase: 'wrong' }) }));
      }
      const owner = { 'x-forwarded-for': '192.0.2.10' };
      const throttled = await sessionPOST(req('/api/session', { method: 'POST', headers: owner, body: JSON.stringify({ passphrase: 'wrong' }) }));
      expect(throttled.status).toBe(429);
      vi.setSystemTime(new Date('2026-09-29T10:00:06Z'));
      const ownerLogin = await sessionPOST(req('/api/session', { method: 'POST', headers: owner, body: JSON.stringify({ passphrase: 'letmein' }) }));
      expect(ownerLogin.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('manuscript upload cap', () => {
  it('rejects an oversized manuscript with 413', async () => {
    const oversized = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' });
    const form = new FormData();
    form.append('file', oversized);
    const res = await manuscriptPOST(req('/api/reviews/rev-cap/manuscript', { method: 'POST', body: form }), {
      params: Promise.resolve({ id: 'rev-cap' }),
    });
    expect(res.status).toBe(413);
  });
});

describe('SSE events route (API-22)', () => {
  it('streams replayed persisted events with an id line', async () => {
    const { sqlite } = getClient();
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO reviews (id, slug, status, current_phase, created_at, updated_at) VALUES ('rev-sse','rev-sse','running','phase_1',?,?)").run(now, now);
    sqlite
      .prepare('INSERT INTO review_events (id, review_id, seq, ts, kind, phase, payload_json) VALUES (?, ?, 1, ?, ?, ?, ?)')
      .run(randomUUID(), 'rev-sse', now, 'phase_transition', 'phase_1', '{"status":"active"}');

    const controller = new AbortController();
    const request = new NextRequest('http://127.0.0.1/api/reviews/rev-sse/events', { signal: controller.signal });
    const res = await eventsGET(request, { params: Promise.resolve({ id: 'rev-sse' }) });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('id: 1');
    expect(text).toContain('event: phase_status');

    controller.abort();
    await reader!.cancel().catch(() => undefined);
  });
});

describe('SSE events route for an unknown review', () => {
  it('returns 404 instead of streaming an empty run', async () => {
    const res = await eventsGET(req('/api/reviews/nope/events'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

describe('cross-site request guard', () => {
  it('refuses a state-changing request a browser marks cross-site', async () => {
    const res = await reviewsPOST(
      req('/api/reviews', { method: 'POST', body: JSON.stringify({ title: 'x' }), headers: { 'sec-fetch-site': 'cross-site' } }),
    );
    expect(res.status).toBe(403);
  });

  it('falls back to comparing Origin with Host', async () => {
    const foreign = await reviewsPOST(
      req('/api/reviews', { method: 'POST', body: JSON.stringify({ title: 'x' }), headers: { origin: 'https://evil.example', host: '127.0.0.1' } }),
    );
    expect(foreign.status).toBe(403);
    const same = await reviewsPOST(
      req('/api/reviews', { method: 'POST', body: JSON.stringify({ title: 'x' }), headers: { origin: 'http://127.0.0.1', host: '127.0.0.1' } }),
    );
    expect(same.status).toBe(201);
  });

  it('leaves reads alone', async () => {
    const res = await reviewsGET(req('/api/reviews', { headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(res.status).toBe(200);
  });
});

describe('request body validation', () => {
  it('rejects a mistyped settings patch with 422 instead of crashing', async () => {
    const wrongType = await settingsPUT(req('/api/settings', { method: 'PUT', body: JSON.stringify({ passphrase: 123 }) }));
    expect(wrongType.status).toBe(422);
    const nullBody = await settingsPUT(req('/api/settings', { method: 'PUT', body: 'null' }));
    expect(nullBody.status).toBe(422);
  });

  it('rejects a non-string review title', async () => {
    const res = await reviewsPOST(req('/api/reviews', { method: 'POST', body: JSON.stringify({ title: 5 }) }));
    expect(res.status).toBe(422);
  });

  it('refuses an upload whose declared length is over the cap before parsing it', async () => {
    const created = await reviewsPOST(req('/api/reviews', { method: 'POST', body: JSON.stringify({ title: 'Big' }) }));
    const { id } = (await created.json()) as { id: string };
    const res = await manuscriptPOST(
      req(`/api/reviews/${id}/manuscript`, { method: 'POST', body: 'x', headers: { 'content-length': String(200 * 1024 * 1024) } }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(413);
  });
});
