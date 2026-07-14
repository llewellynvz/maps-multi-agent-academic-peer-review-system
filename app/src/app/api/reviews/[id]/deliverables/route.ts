import { type NextRequest, NextResponse } from 'next/server';
import { getClient, listDeliverables } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json({ deliverables: listDeliverables(db, id) });
  });
}
