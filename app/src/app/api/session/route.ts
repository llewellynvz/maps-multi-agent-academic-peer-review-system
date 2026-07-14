import { type NextRequest, NextResponse } from 'next/server';
import { getClient, issueToken, passphraseIsSet, SESSION_COOKIE, verifyPassphrase } from 'server/src/data';
import { jsonError } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { passphrase?: string };
    const { db } = getClient();
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';

    if (passphraseIsSet(db) && !verifyPassphrase(db, passphrase)) {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'The passphrase does not match.' } },
        { status: 401 },
      );
    }

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
