import { type NextRequest, NextResponse } from 'next/server';
import { getClient, submitAnswers, type SubmittedAnswer } from 'server/src/data';
import { z } from 'zod';
import { guarded, parseBody } from '@/lib/server';

const answersSchema = z.object({
  answers: z.array(z.object({ questionId: z.string(), value: z.union([z.string(), z.array(z.string())]) })).optional(),
  useDefaults: z.boolean().optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, async () => {
    const body = await parseBody(req, answersSchema);
    const { db } = getClient();
    const result = submitAnswers(db, id, {
      answers: (body.answers ?? []) as SubmittedAnswer[],
      ...(body.useDefaults !== undefined ? { useDefaults: body.useDefaults } : {}),
    });
    return NextResponse.json(result);
  });
}
