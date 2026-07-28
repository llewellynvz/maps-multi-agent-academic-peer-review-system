import { randomUUID } from 'node:crypto';
import { generateObject, generateText, type LanguageModel, type ModelMessage } from 'ai';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { MaraDatabase } from '../db/client';
import { dispatches } from '../db/schema';
import { readSetting } from '../data/settings-store';
import { activeTraceId as sharedActiveTraceId } from '../tracing/hierarchy';
import { estimateCostUsd, hasPricing } from './pricing';
import type { Registry } from './registry';
import type { DispatchProvider, ModelRef, Role } from './types';

export interface PromptParts {
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface DispatchTokens {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface DispatchResult {
  dispatchId: string;
  provider: DispatchProvider;
  model: string;
  status: 'success' | 'error';
  text?: string;
  object?: unknown;
  tokens: DispatchTokens;
  latencyMs: number;
  langfuseTraceId: string | null;
  replayed: boolean;
}

export interface DispatchInput {
  reviewId: string;
  phase: string;
  agent: string;
  promptVersion: string;
  role?: Role;
  model?: ModelRef;
  parts: PromptParts;
  schema?: z.ZodType;
  dispatchId?: string;
  temperature?: number;
  maxRetries?: number;
  telemetry?: boolean;
  abortSignal?: AbortSignal;
}

interface GenerateCallOptions {
  model: LanguageModel;
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  temperature?: number;
  maxRetries: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  experimental_telemetry: { isEnabled: boolean; functionId: string; recordInputs: boolean; recordOutputs: boolean };
  schema?: z.ZodType;
  abortSignal?: AbortSignal;
}

interface RawUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
}

export interface GenerateApi {
  generateText: (options: GenerateCallOptions) => Promise<{ text: string; usage: unknown }>;
  generateObject: (options: GenerateCallOptions) => Promise<{ object: unknown; usage: unknown }>;
}

export interface DispatchRunnerOptions {
  db: MaraDatabase;
  registry: Registry;
  generate?: GenerateApi;
  now?: () => number;
  activeTraceId?: () => string | null;
  contentCaptureAllowed?: boolean;
}

export type DispatchRunner = (input: DispatchInput) => Promise<DispatchResult>;

const defaultGenerate: GenerateApi = {
  generateText: (options) => generateText(options as Parameters<typeof generateText>[0]),
  generateObject: (options) =>
    generateObject(options as Parameters<typeof generateObject>[0]) as Promise<{ object: unknown; usage: unknown }>,
};

function extractTokens(usage: unknown): DispatchTokens {
  const raw = (usage ?? {}) as RawUsage;
  return {
    inputTokens: raw.inputTokens ?? 0,
    outputTokens: raw.outputTokens ?? 0,
    cachedTokens: raw.inputTokenDetails?.cacheReadTokens ?? raw.cachedInputTokens ?? 0,
    reasoningTokens: raw.outputTokenDetails?.reasoningTokens ?? raw.reasoningTokens ?? 0,
  };
}

function classifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === '' ? 'Error' : error.name;
  }
  return 'unknown';
}

function resolveModelRef(registry: Registry, input: DispatchInput): ModelRef {
  if (input.model !== undefined) {
    return input.model;
  }
  if (input.role !== undefined) {
    return registry.resolveRole(input.role);
  }
  throw new Error('Dispatch input requires either a role or a resolved model reference');
}

export function createDispatchRunner(options: DispatchRunnerOptions): DispatchRunner {
  const generate = options.generate ?? defaultGenerate;
  const now = options.now ?? Date.now;
  const activeTraceId = options.activeTraceId ?? sharedActiveTraceId;
  const { db } = options;
  const unpricedWarned = new Set<string>();

  const findPersisted = (dispatchId: string): DispatchResult | undefined => {
    const rows = db
      .select()
      .from(dispatches)
      .where(and(eq(dispatches.id, dispatchId), eq(dispatches.status, 'success')))
      .limit(1)
      .all();
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      dispatchId: row.id,
      provider: row.provider as DispatchProvider,
      model: row.model,
      status: 'success',
      tokens: {
        inputTokens: row.tokensIn,
        outputTokens: row.tokensOut,
        cachedTokens: row.tokensCached,
        reasoningTokens: row.tokensReasoning,
      },
      latencyMs: row.latencyMs,
      langfuseTraceId: row.langfuseTraceId,
      replayed: true,
    };
  };

  const persist = (
    id: string,
    input: DispatchInput,
    modelRef: ModelRef,
    tokens: DispatchTokens,
    latencyMs: number,
    status: 'success' | 'error',
    errorClass: string | null,
    langfuseTraceId: string | null,
  ): void => {
    if (
      modelRef.providerName !== 'local' &&
      tokens.inputTokens + tokens.outputTokens > 0 &&
      !hasPricing(modelRef.model) &&
      !unpricedWarned.has(modelRef.model)
    ) {
      unpricedWarned.add(modelRef.model);
      console.warn(
        `[dispatch] no pricing entry for model ${modelRef.model}; cost_usd recorded as 0 and the cost ceiling cannot see this spend. Set MARA_PRICING_${modelRef.model.toUpperCase().replace(/[^A-Z0-9]/g, '_')}=input,cached,output (USD per million tokens).`,
      );
    }
    db.insert(dispatches)
      .values({
        id,
        reviewId: input.reviewId,
        phase: input.phase,
        agent: input.agent,
        provider: modelRef.providerName,
        model: modelRef.model,
        promptVersion: input.promptVersion,
        tokensIn: tokens.inputTokens,
        tokensOut: tokens.outputTokens,
        tokensCached: tokens.cachedTokens,
        tokensReasoning: tokens.reasoningTokens,
        latencyMs,
        costUsd: estimateCostUsd(modelRef.model, tokens),
        retries: 0,
        status,
        errorClass,
        langfuseTraceId,
        createdAt: new Date().toISOString(),
      })
      .run();
  };

  return async function runDispatch(input: DispatchInput): Promise<DispatchResult> {
    const modelRef = resolveModelRef(options.registry, input);

    if (input.dispatchId !== undefined) {
      const replay = findPersisted(input.dispatchId);
      if (replay !== undefined) {
        return replay;
      }
    }

    const recordContent = options.contentCaptureAllowed === true && readSetting<boolean>(db, 'langfuse_content') === true;
    const callOptions: GenerateCallOptions = {
      model: modelRef.languageModel,
      maxRetries: input.maxRetries ?? 2,
      experimental_telemetry: {
        isEnabled: input.telemetry ?? true,
        functionId: `${input.phase}:${input.agent}`,
        recordInputs: recordContent,
        recordOutputs: recordContent,
      },
    };
    if (input.parts.system !== undefined) {
      callOptions.system = input.parts.system;
    }
    if (input.parts.prompt !== undefined) {
      callOptions.prompt = input.parts.prompt;
    }
    if (input.parts.messages !== undefined) {
      callOptions.messages = input.parts.messages;
    }
    if (input.parts.providerOptions !== undefined) {
      callOptions.providerOptions = input.parts.providerOptions;
    }
    if (input.abortSignal !== undefined) {
      callOptions.abortSignal = input.abortSignal;
    }
    if (input.temperature !== undefined && !modelRef.isReasoning) {
      callOptions.temperature = input.temperature;
    }
    if (modelRef.isReasoning) {
      const openaiOptions = callOptions.providerOptions?.openai ?? {};
      callOptions.providerOptions = {
        ...callOptions.providerOptions,
        openai: { reasoningEffort: 'xhigh', ...openaiOptions },
      };
    }

    const started = now();
    try {
      let text: string | undefined;
      let object: unknown;
      let usage: unknown;
      if (input.schema !== undefined) {
        const result = await generate.generateObject({ ...callOptions, schema: input.schema });
        object = result.object;
        usage = result.usage;
      } else {
        const result = await generate.generateText(callOptions);
        text = result.text;
        usage = result.usage;
      }
      const latencyMs = now() - started;
      const tokens = extractTokens(usage);
      const langfuseTraceId = activeTraceId();
      const id = input.dispatchId ?? randomUUID();
      persist(id, input, modelRef, tokens, latencyMs, 'success', null, langfuseTraceId);
      return {
        dispatchId: id,
        provider: modelRef.providerName,
        model: modelRef.model,
        status: 'success',
        text,
        object,
        tokens,
        latencyMs,
        langfuseTraceId,
        replayed: false,
      };
    } catch (error) {
      const latencyMs = now() - started;
      const langfuseTraceId = activeTraceId();
      persist(
        randomUUID(),
        input,
        modelRef,
        extractTokens((error as { usage?: unknown }).usage),
        latencyMs,
        'error',
        classifyError(error),
        langfuseTraceId,
      );
      throw error;
    }
  };
}
