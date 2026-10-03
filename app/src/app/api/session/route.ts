import { type NextRequest, NextResponse } from 'next/server';
import { getClient, issueToken, passphraseIsSet, SESSION_COOKIE, verifyPassphrase } from 'server/src/data';
import { crossSiteDenied, hostDenied, jsonError } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FAILURE_LIMIT = 5;
const GLOBAL_FAILURE_LIMIT = 20;
const WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
let globalFailures = { count: 0, resetAt: 0 };
// Past the global limit, a hard lockout would let anyone lock the owner out by failing 20 times. Instead one
// passphrase check is allowed through every GLOBAL_DRIP_MS across all clients. At 45 s that is 80 guesses an
// hour, the same ceiling the old 20-per-15-minutes lockout allowed, while the owner can still get in.
const GLOBAL_DRIP_MS = 45_000;
let lastGlobalDrip = 0;

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded !== null && forwarded !== '' ? (forwarded.split(',')[0] as string).trim() : 'local';
}

function pruneExpired(now: number): void {
  for (const [key, record] of failedAttempts) {
    if (now >= record.resetAt) {
      failedAttempts.delete(key);
    }
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const badHost = hostDenied(req);
  if (badHost !== null) {
    return badHost;
  }
  const crossSite = crossSiteDenied(req);
  if (crossSite !== null) {
    return crossSite;
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { passphrase?: string };
    const { db } = getClient();
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';

    const key = clientKey(req);
    const now = Date.now();
    pruneExpired(now);
    if (now >= globalFailures.resetAt) {
      globalFailures = { count: 0, resetAt: now + WINDOW_MS };
    }
    const active = failedAttempts.get(key);

    const clientLocked = active !== undefined && active.count >= FAILURE_LIMIT;
    let globalLocked = globalFailures.count >= GLOBAL_FAILURE_LIMIT;
    if (globalLocked && !clientLocked && now - lastGlobalDrip >= GLOBAL_DRIP_MS) {
      lastGlobalDrip = now;
      globalLocked = false;
    }
    if (clientLocked || globalLocked) {
      const retryAfter = clientLocked ? Math.ceil((active.resetAt - now) / 1000) : Math.ceil(GLOBAL_DRIP_MS / 1000);
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many failed attempts. Try again later.' } },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    if (passphraseIsSet(db) && !verifyPassphrase(db, passphrase)) {
      const next = active ?? { count: 0, resetAt: now + WINDOW_MS };
      next.count += 1;
      failedAttempts.set(key, next);
      globalFailures.count += 1;
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'The passphrase does not match.' } },
        { status: 401 },
      );
    }

    failedAttempts.delete(key);
    globalFailures.count = 0;
    const issued = issueToken(db);
    const response = NextResponse.json(issued);
    const secure = req.headers.get('x-forwarded-proto') === 'https' || new URL(req.url).protocol === 'https:';
    response.cookies.set(SESSION_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      expires: new Date(issued.expiresAt),
      secure,
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
