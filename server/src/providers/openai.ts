import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { type EnvSource, requireEnv } from './env';
import type { ModelFactory } from './ollama';

export function createOpenAiProvider(env: EnvSource): ModelFactory {
  const apiKey = requireEnv(env, 'OPENAI_API_KEY');
  const openai = createOpenAI({ apiKey });
  return (model: string): LanguageModel => openai(model);
}
