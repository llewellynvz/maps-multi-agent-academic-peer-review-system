import { type NextRequest, NextResponse } from 'next/server';
import { getClient, submitRunControl } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json(submitRunControl(db, id, 'cancel'));
  });
}
