import { type NextRequest, NextResponse } from 'next/server';
import { accessDenied, getClient, isApiError, SESSION_COOKIE } from 'server/src/data';

export function client() {
  return getClient();
}

export function jsonError(error: unknown): NextResponse {
  if (isApiError(error)) {
    return NextResponse.json(error.body(), { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  return NextResponse.json({ error: { code: 'internal', message } }, { status: 500 });
}

export function tokenFrom(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (header !== null && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

export function authDenied(req: NextRequest): NextResponse | null {
  const { db } = getClient();
  if (!accessDenied(db, tokenFrom(req))) {
    return null;
  }
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'A valid session is required for this instance.' } },
    { status: 401 },
  );
}

export async function guarded(
  req: NextRequest,
  handler: () => Promise<NextResponse> | NextResponse,
): Promise<NextResponse> {
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
