import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, ModelMessage } from 'ai';
import { type EnvSource, requireEnv } from './env';
import type { ModelFactory } from './ollama';

export function createAnthropicProvider(env: EnvSource): ModelFactory {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const anthropic = createAnthropic({ apiKey });
  return (model: string): LanguageModel => anthropic(model);
}

export function buildCachedSystemMessages(sharedPrefix: string, userPrompt: string): ModelMessage[] {
  return [
    {
      role: 'system',
      content: sharedPrefix,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    { role: 'user', content: userPrompt },
  ];
}
