import { type NextRequest, NextResponse } from 'next/server';
import { ApiError, getClient, uploadManuscript } from 'server/src/data';
import { guarded } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  return guarded(req, async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ApiError('bad_request', 'Attach the manuscript as multipart form field "file".', { field: 'file' });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: { code: 'payload_too_large', message: 'The manuscript exceeds the 50 MB upload limit.' } },
        { status: 413 },
      );
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
