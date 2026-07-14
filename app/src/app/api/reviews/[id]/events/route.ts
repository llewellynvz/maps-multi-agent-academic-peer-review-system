import type { NextRequest } from 'next/server';
import { deriveEphemeral, getClient, maxSeq, replayEvents } from 'server/src/data';
import { authDenied } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

function frame(event: string, data: unknown, seq?: number): string {
  const idLine = seq !== undefined ? `id: ${seq}\n` : '';
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest, context: Context): Promise<Response> {
  const denied = authDenied(req);
  if (denied !== null) {
    return denied;
  }
  const { id } = await context.params;

  const lastEventHeader = req.headers.get('last-event-id');
  const lastEventQuery = new URL(req.url).searchParams.get('lastEventId');
  const startFrom = Number.parseInt(lastEventHeader ?? lastEventQuery ?? '0', 10);
  let lastSeq = Number.isFinite(startFrom) ? startFrom : 0;

  const encoder = new TextEncoder();
  const { db } = getClient();
  let close: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string): boolean => {
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          close();
          return false;
        }
      };

      const replay = (): void => {
        for (const event of replayEvents(db, id, lastSeq)) {
          if (!send(frame(event.event, event.data, event.seq))) {
            return;
          }
          lastSeq = event.seq;
        }
      };

      const ephemeral = (): void => {
        for (const event of deriveEphemeral(db, id)) {
          if (!send(frame(event.event, event.data))) {
            return;
          }
        }
      };

      const persistedTimer = setInterval(() => {
        try {
          if (maxSeq(db, id) > lastSeq) {
            replay();
          }
        } catch {
          close();
        }
      }, 1000);

      const ephemeralTimer = setInterval(() => {
        try {
          ephemeral();
        } catch {
          close();
        }
      }, 2000);

      const heartbeatTimer = setInterval(() => {
        send(': ping\n\n');
      }, 15000);

      close = (): void => {
        clearInterval(persistedTimer);
        clearInterval(ephemeralTimer);
        clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener('abort', close);

      try {
        replay();
        ephemeral();
      } catch {
        close();
      }
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
