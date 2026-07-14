import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getClient, resetClient } from 'server/src/data';
import { GET as healthGET } from '@/app/api/health/route';
import { POST as sessionPOST } from '@/app/api/session/route';
import { GET as reviewsGET, POST as reviewsPOST } from '@/app/api/reviews/route';
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/settings/route';
import { GET as eventsGET } from '@/app/api/reviews/[id]/events/route';

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
