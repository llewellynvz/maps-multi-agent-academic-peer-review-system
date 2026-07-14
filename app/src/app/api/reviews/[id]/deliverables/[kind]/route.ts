import { type NextRequest, NextResponse } from 'next/server';
import {
  ApiError,
  type DeliverableFormat,
  type DeliverableKind,
  getClient,
  getDeliverable,
} from 'server/src/data';
import { authDenied, jsonError } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; kind: string }> };

const KINDS = new Set<DeliverableKind>(['peer_review_report', 'reviewer_private_notes', 'ledger_export', 'run_archive']);
const FORMATS = new Set<DeliverableFormat>(['docx', 'md', 'zip']);

export async function GET(req: NextRequest, context: Context): Promise<Response> {
  const denied = authDenied(req);
  if (denied !== null) {
    return denied;
  }
  const { id, kind } = await context.params;
  try {
    if (!KINDS.has(kind as DeliverableKind)) {
      throw new ApiError('not_found', `Unknown deliverable kind ${kind}.`);
    }
    const formatParam = new URL(req.url).searchParams.get('format');
    if (formatParam !== null && !FORMATS.has(formatParam as DeliverableFormat)) {
      throw new ApiError('bad_request', `Unsupported format ${formatParam}.`, { field: 'format' });
    }
    const { db } = getClient();
    const stream = await getDeliverable(
      db,
      id,
      kind as DeliverableKind,
      formatParam !== null ? (formatParam as DeliverableFormat) : undefined,
    );
    return new NextResponse(new Uint8Array(stream.bytes), {
      status: 200,
      headers: {
        'Content-Type': stream.mime,
        'Content-Disposition': `attachment; filename="${stream.filename}"`,
        'Content-Length': String(stream.bytes.byteLength),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
