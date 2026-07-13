import { trace } from '@opentelemetry/api';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';

export const SESSION_ID_ATTRIBUTE = 'langfuse.session.id';

export function startRun<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return startActiveObservation(runId, async (root) => {
    trace.getActiveSpan()?.setAttribute(SESSION_ID_ATTRIBUTE, runId);
    try {
      return await propagateAttributes({ sessionId: runId }, fn);
    } finally {
      root.end();
    }
  });
}

export function withPhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return startActiveObservation(name, async (span) => {
    try {
      return await fn();
    } finally {
      span.end();
    }
  });
}

export function activeTraceId(): string | null {
  const span = trace.getActiveSpan();
  if (span === undefined) {
    return null;
  }
  const spanContext = span.spanContext();
  return spanContext.traceId === '00000000000000000000000000000000' ? null : spanContext.traceId;
}
