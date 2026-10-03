import { type NextRequest, NextResponse } from 'next/server';
import { getClient, health } from 'server/src/data';
import { hostDenied } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest): NextResponse {
  const badHost = hostDenied(req);
  if (badHost !== null) {
    return badHost;
  }
  const { db } = getClient();
  return NextResponse.json(health(db));
}
