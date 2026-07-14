import { type NextRequest, NextResponse } from 'next/server';
import { getClient, getSettings, putSettings, type SettingsPatch } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return guarded(req, () => {
    const { db } = getClient();
    return NextResponse.json(getSettings(db));
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  return guarded(req, async () => {
    const body = (await req.json().catch(() => ({}))) as SettingsPatch;
    const { db } = getClient();
    return NextResponse.json(putSettings(db, body));
  });
}
