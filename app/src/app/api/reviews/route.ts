import { type NextRequest, NextResponse } from 'next/server';
import { createReview, getClient, listReviews, purgeAll, type ReviewOptions } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json({ reviews: listReviews(db) });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return guarded(req, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      providerProfile?: string;
      options?: ReviewOptions;
    };
    const { db } = getClient();
    const review = createReview(db, {
      title: body.title ?? null,
      ...(body.providerProfile !== undefined ? { providerProfile: body.providerProfile } : {}),
      ...(body.options !== undefined ? { options: body.options } : {}),
    });
    return NextResponse.json(review, { status: 201 });
  });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return guarded(req, () => {
    const client = getClient();
    const result = purgeAll(client);
    return NextResponse.json(result);
  });
}
