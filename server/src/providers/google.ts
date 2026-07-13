import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { type EnvSource, requireEnv } from './env';
import type { ModelFactory } from './ollama';

export function createGoogleProvider(env: EnvSource): ModelFactory {
  const apiKey = requireEnv(env, 'GOOGLE_API_KEY');
  const google = createGoogleGenerativeAI({ apiKey });
  return (model: string): LanguageModel => google(model);
}
