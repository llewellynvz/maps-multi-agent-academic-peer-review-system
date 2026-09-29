import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getClient, getSettings, putSettings, type SettingsPatch } from 'server/src/data';
import { guarded, parseBody } from '@/lib/server';

const settingsPatchSchema = z.object({
  telemetry: z.boolean().optional(),
  langfuseContent: z.boolean().optional(),
  presetDefault: z.string().optional(),
  providerProfile: z.string().optional(),
  costCeilingUsd: z.number().nullable().optional(),
  passphrase: z.string().nullable().optional(),
});

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
    const body = (await parseBody(req, settingsPatchSchema)) as SettingsPatch;
    const { db } = getClient();
    return NextResponse.json(putSettings(db, body));
  });
}
