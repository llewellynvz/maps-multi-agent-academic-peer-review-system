import type { NextRequest } from 'next/server';
import { deriveEphemeral, getClient, maxSeq, replayEvents, reviewTerminalState } from 'server/src/data';
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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string): boolean => {
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          return false;
        }
      };

      const replay = (): void => {
        for (const event of replayEvents(db, id, lastSeq)) {
          send(frame(event.event, event.data, event.seq));
          lastSeq = event.seq;
        }
      };

      const ephemeral = (): void => {
        for (const event of deriveEphemeral(db, id)) {
          send(frame(event.event, event.data));
        }
      };

      replay();
      ephemeral();

      const persistedTimer = setInterval(() => {
        try {
          if (maxSeq(db, id) > lastSeq) {
            replay();
          }
        } catch {
          /* review purged mid-stream */
        }
      }, 1000);

      const ephemeralTimer = setInterval(() => {
        try {
          const state = reviewTerminalState(db, id);
          ephemeral();
          if (state.terminal) {
            // The terminal audit event has already been replayed; keep the connection
            // open on a heartbeat so a late reconnect still resolves cleanly.
          }
        } catch {
          /* review purged mid-stream */
        }
      }, 2000);

      const heartbeatTimer = setInterval(() => {
        send(': ping\n\n');
      }, 15000);

      const close = (): void => {
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
