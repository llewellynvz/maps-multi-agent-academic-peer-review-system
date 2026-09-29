import { type NextRequest, NextResponse } from 'next/server';
import { ApiError, createReview, getClient, listReviews, purgeAll, type ReviewOptions } from 'server/src/data';
import { z } from 'zod';
import { guarded, parseBody } from '@/lib/server';

const createReviewSchema = z.object({
  title: z.string().nullish(),
  providerProfile: z.string().optional(),
  options: z
    .looseObject({
      pauseAtGates: z.boolean().optional(),
      lensOverrides: z.array(z.string()).optional(),
      preset: z.string().optional(),
    })
    .optional(),
});

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
    const body = await parseBody(req, createReviewSchema);
    const { db } = getClient();
    const review = createReview(db, {
      title: body.title ?? null,
      ...(body.providerProfile !== undefined ? { providerProfile: body.providerProfile } : {}),
      ...(body.options !== undefined ? { options: body.options as ReviewOptions } : {}),
    });
    return NextResponse.json(review, { status: 201 });
  });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return guarded(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== 'delete everything') {
      throw new ApiError('bad_request', 'Send { "confirm": "delete everything" } to delete every review.', {
        field: 'confirm',
      });
    }
    const client = getClient();
    const result = purgeAll(client);
    return NextResponse.json(result);
  });
}
