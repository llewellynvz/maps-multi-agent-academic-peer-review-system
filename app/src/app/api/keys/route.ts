import { type NextRequest, NextResponse } from 'next/server';
import { addKey, type AddKeyInput, getClient, listKeys } from 'server/src/data';
import { guarded } from '@/lib/server';

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
    const body = (await req.json().catch(() => ({}))) as Partial<AddKeyInput>;
    const { db } = getClient();
    const key = addKey(db, {
      provider: body.provider ?? '',
      apiKey: body.apiKey ?? '',
      persist: body.persist === 'session' ? 'session' : 'disk',
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
    });
    return NextResponse.json(key, { status: 201 });
  });
}
