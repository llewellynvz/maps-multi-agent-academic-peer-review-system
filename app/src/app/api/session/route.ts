import { type NextRequest, NextResponse } from 'next/server';
import { getClient, issueToken, passphraseIsSet, SESSION_COOKIE, verifyPassphrase } from 'server/src/data';
import { jsonError } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FAILURE_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded !== null && forwarded !== '' ? (forwarded.split(',')[0] as string).trim() : 'local';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { passphrase?: string };
    const { db } = getClient();
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';

    const key = clientKey(req);
    const now = Date.now();
    const record = failedAttempts.get(key);
    const active = record !== undefined && now < record.resetAt ? record : undefined;

    if (active !== undefined && active.count >= FAILURE_LIMIT) {
      const retryAfter = Math.ceil((active.resetAt - now) / 1000);
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many failed attempts. Try again later.' } },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    if (passphraseIsSet(db) && !verifyPassphrase(db, passphrase)) {
      const next = active ?? { count: 0, resetAt: now + WINDOW_MS };
      next.count += 1;
      failedAttempts.set(key, next);
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'The passphrase does not match.' } },
        { status: 401 },
      );
    }

    failedAttempts.delete(key);
    const issued = issueToken(db);
    const response = NextResponse.json(issued);
    response.cookies.set(SESSION_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      expires: new Date(issued.expiresAt),
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
