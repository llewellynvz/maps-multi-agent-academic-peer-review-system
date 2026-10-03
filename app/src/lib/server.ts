import { type NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';
import { accessDenied, ApiError, getClient, isApiError, passphraseIsSet, SESSION_COOKIE } from 'server/src/data';
import { isLoopbackHost } from './host';

export function client() {
  return getClient();
}

export function jsonError(error: unknown): NextResponse {
  if (isApiError(error)) {
    return NextResponse.json(error.body(), { status: error.status });
  }
  console.error('[api] unhandled route error', error);
  return NextResponse.json({ error: { code: 'internal', message: 'Unexpected error.' } }, { status: 500 });
}

// Parses a JSON body against a schema. A missing or unparseable body counts as `{}` so optional fields
// fall back to their defaults; a body of the wrong shape is a 422 rather than a TypeError deeper down.
export async function parseBody<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue !== undefined && issue.path.length > 0 ? issue.path.join('.') : undefined;
    throw new ApiError('unprocessable', `The request body is not valid${field !== undefined ? ` (${field})` : ''}.`, field !== undefined ? { field } : undefined);
  }
  return parsed.data;
}

// req.formData() buffers the whole body, so an upload is refused on its declared length before parsing.
// The allowance covers the multipart envelope around a file that is itself within the limit.
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export function declaredBodyTooLarge(req: NextRequest, maxFileBytes: number): boolean {
  const declared = Number(req.headers.get('content-length'));
  return Number.isFinite(declared) && declared > maxFileBytes + MULTIPART_OVERHEAD_BYTES;
}

export function tokenFrom(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (header !== null && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

// Without a passphrase every request is authorised, so only loopback names are served. Only Host is
// trusted: a DNS-rebinding page can set X-Forwarded-Host itself but never Host.
export function hostDenied(req: NextRequest): NextResponse | null {
  if (isLoopbackHost(req.headers.get('host')) || passphraseIsSet(getClient().db)) {
    return null;
  }
  return NextResponse.json(
    {
      error: {
        code: 'forbidden',
        message: 'Open MAPS on localhost and set a passphrase in Settings to use it on any other address.',
      },
    },
    { status: 403 },
  );
}

export function authDenied(req: NextRequest): NextResponse | null {
  const badHost = hostDenied(req);
  if (badHost !== null) {
    return badHost;
  }
  const { db } = getClient();
  if (!accessDenied(db, tokenFrom(req))) {
    return null;
  }
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'A valid session is required for this instance.' } },
    { status: 401 },
  );
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// With no passphrase set every request is authorised, and a cross-site page can still send a "simple"
// text/plain POST without a preflight. Refuse state-changing requests that a browser marks as coming
// from another site. Sec-Fetch-Site is authoritative when present; older clients fall back to Origin.
export function crossSiteDenied(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method)) {
    return null;
  }
  const site = req.headers.get('sec-fetch-site');
  let foreign = false;
  if (site !== null) {
    foreign = site !== 'same-origin' && site !== 'none';
  } else {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin !== null && host !== null) {
      try {
        foreign = new URL(origin).host !== host;
      } catch {
        foreign = true;
      }
    }
  }
  if (!foreign) {
    return null;
  }
  return NextResponse.json(
    { error: { code: 'forbidden', message: 'Cross-site requests are not allowed.' } },
    { status: 403 },
  );
}

export function originDenied(req: NextRequest): NextResponse | null {
  return hostDenied(req) ?? crossSiteDenied(req);
}

export async function guarded(
  req: NextRequest,
  handler: () => Promise<NextResponse> | NextResponse,
): Promise<NextResponse> {
  const foreign = originDenied(req);
  if (foreign !== null) {
    return foreign;
  }
  const denied = authDenied(req);
  if (denied !== null) {
    return denied;
  }
  try {
    return await handler();
  } catch (error) {
    return jsonError(error);
  }
}
