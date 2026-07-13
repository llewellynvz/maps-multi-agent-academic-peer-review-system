import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_ID_ATTRIBUTE, startRun, withPhase } from '../hierarchy';
import { initTracing, resetTracingForTest } from '../langfuse';

function parentIdOf(span: ReadableSpan): string | undefined {
  const withContext = span as ReadableSpan & { parentSpanContext?: { spanId: string }; parentSpanId?: string };
  return withContext.parentSpanContext?.spanId ?? withContext.parentSpanId;
}

describe('initTracing no-op mode', () => {
  it('returns a disabled handle and performs no setup when Langfuse env is absent', async () => {
    resetTracingForTest();
    const handle = initTracing({ env: {} });

    expect(handle.enabled).toBe(false);
    await expect(handle.forceFlush()).resolves.toBeUndefined();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('still runs run and phase bodies when tracing is disabled', async () => {
    resetTracingForTest();
    initTracing({ env: {} });

    const value = await startRun('run-disabled', async () =>
      withPhase('phase-disabled', async () => 'executed'),
    );
    expect(value).toBe('executed');
  });
});

describe('tracing hierarchy', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  it('nests a phase span under the run span and stamps the session id on the root', async () => {
    exporter.reset();

    await startRun('exercise-session-1', async () => {
      await withPhase('phase-frontier', async () => undefined);
    });

    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();

    const root = spans.find((span) => span.name === 'exercise-session-1');
    const phase = spans.find((span) => span.name === 'phase-frontier');
    expect(root).toBeDefined();
    expect(phase).toBeDefined();

    expect(root && parentIdOf(root)).toBeUndefined();
    expect(phase && parentIdOf(phase)).toBe(root?.spanContext().spanId);
    expect(root?.attributes[SESSION_ID_ATTRIBUTE]).toBe('exercise-session-1');
  });

  it('shares one trace id across the run and all its phases', async () => {
    exporter.reset();

    await startRun('exercise-session-2', async () => {
      await withPhase('phase-a', async () => undefined);
      await withPhase('phase-b', async () => undefined);
    });

    await provider.forceFlush();
    const traceIds = new Set(exporter.getFinishedSpans().map((span) => span.spanContext().traceId));
    expect(traceIds.size).toBe(1);
  });
});
