import { type NextRequest, NextResponse } from 'next/server';
import { ApiError, getClient, uploadManuscript } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ApiError('bad_request', 'Attach the manuscript as multipart form field "file".', { field: 'file' });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { db } = getClient();
    const result = uploadManuscript(db, id, {
      bytes,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
    });
    return NextResponse.json(result, { status: 201 });
  });
}
