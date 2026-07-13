import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerTelemetry } from 'ai';
import { type EnvSource, getEnv } from '../providers/env';

export interface TracingHandle {
  enabled: boolean;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  host: string;
}

export interface InitTracingOptions {
  env?: EnvSource;
  spanProcessor?: SpanProcessor;
  registerIntegration?: boolean;
}

const disabledHandle: TracingHandle = {
  enabled: false,
  forceFlush: async (): Promise<void> => undefined,
  shutdown: async (): Promise<void> => undefined,
};

let active: { provider: NodeTracerProvider; handle: TracingHandle } | null = null;
let integrationRegistered = false;

export function readLangfuseConfig(env: EnvSource): LangfuseConfig | null {
  const publicKey = getEnv(env, 'LANGFUSE_PUBLIC_KEY');
  const secretKey = getEnv(env, 'LANGFUSE_SECRET_KEY');
  const host = getEnv(env, 'LANGFUSE_HOST');
  if (publicKey === undefined || secretKey === undefined || host === undefined) {
    return null;
  }
  return { publicKey, secretKey, host };
}

export function initTracing(options: InitTracingOptions = {}): TracingHandle {
  if (active !== null) {
    return active.handle;
  }

  const env = options.env ?? process.env;
  const config = readLangfuseConfig(env);
  if (config === null && options.spanProcessor === undefined) {
    return disabledHandle;
  }

  const spanProcessor =
    options.spanProcessor ??
    new LangfuseSpanProcessor({
      publicKey: config?.publicKey,
      secretKey: config?.secretKey,
      baseUrl: config?.host,
    });

  const provider = new NodeTracerProvider({ spanProcessors: [spanProcessor] });
  provider.register();

  if ((options.registerIntegration ?? true) && !integrationRegistered) {
    registerTelemetry(new LangfuseVercelAiSdkIntegration());
    integrationRegistered = true;
  }

  const handle: TracingHandle = {
    enabled: true,
    forceFlush: (): Promise<void> => provider.forceFlush(),
    shutdown: async (): Promise<void> => {
      await provider.shutdown();
      active = null;
    },
  };
  active = { provider, handle };
  return handle;
}

export function resetTracingForTest(): void {
  active = null;
  integrationRegistered = false;
}
