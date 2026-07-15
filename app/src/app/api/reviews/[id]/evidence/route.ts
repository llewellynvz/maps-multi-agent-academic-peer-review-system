import { type NextRequest, NextResponse } from 'next/server';
import { getClient, getEvidenceData } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const REVIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!REVIEW_ID.test(id)) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Review not found.' } }, { status: 404 });
  }
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json(getEvidenceData(db, id));
  });
}
