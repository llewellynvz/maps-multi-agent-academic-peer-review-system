import { type NextRequest, NextResponse } from 'next/server';
import { getClient, getInstanceStats } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json(getInstanceStats(db));
  });
}
