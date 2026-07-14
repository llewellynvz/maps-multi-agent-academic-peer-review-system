import { type NextRequest, NextResponse } from 'next/server';
import { deleteKey, getClient } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, () => {
    const { db } = getClient();
    deleteKey(db, id);
    return NextResponse.json({ deleted: true });
  });
}
