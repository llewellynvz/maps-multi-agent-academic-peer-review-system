import { type NextRequest, NextResponse } from 'next/server';
import { getClient, getReviewDetail, purgeReview } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json(getReviewDetail(db, id));
  });
}

export async function DELETE(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, () => {
    const cl = getClient();
    purgeReview(cl, id);
    return NextResponse.json({ purged: true });
  });
}
