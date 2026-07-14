import { type NextRequest, NextResponse } from 'next/server';
import { getClient, submitAnswers, type SubmittedAnswer } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { answers?: SubmittedAnswer[]; useDefaults?: boolean };
    const { db } = getClient();
    const result = submitAnswers(db, id, {
      answers: Array.isArray(body.answers) ? body.answers : [],
      ...(body.useDefaults !== undefined ? { useDefaults: body.useDefaults } : {}),
    });
    return NextResponse.json(result);
  });
}
