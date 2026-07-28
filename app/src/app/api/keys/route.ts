import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addKey, getClient, listKeys } from 'server/src/data';
import { guarded } from '@/lib/server';

const addKeyBodySchema = z.object({
  provider: z.string().default(''),
  apiKey: z.string().default(''),
  persist: z.enum(['disk', 'session']).default('disk'),
  label: z.string().nullish(),
  baseUrl: z.string().nullish(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json({ keys: listKeys(db) });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return guarded(req, async () => {
    const parsed = addKeyBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'unprocessable', message: 'The provider key payload is not valid.' } },
        { status: 422 },
      );
    }
    const body = parsed.data;
    const { db } = getClient();
    const key = addKey(db, {
      provider: body.provider,
      apiKey: body.apiKey,
      persist: body.persist,
      ...(body.label !== undefined && body.label !== null ? { label: body.label } : {}),
      ...(body.baseUrl !== undefined && body.baseUrl !== null ? { baseUrl: body.baseUrl } : {}),
    });
    return NextResponse.json(key, { status: 201 });
  });
}
