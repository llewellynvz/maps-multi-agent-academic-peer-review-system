import type { LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { type EnvSource, requireEnv } from './env';

export type ModelFactory = (model: string) => LanguageModel;

export function createOllamaProvider(env: EnvSource): ModelFactory {
  const baseURL = requireEnv(env, 'OLLAMA_BASE_URL');
  const ollama = createOllama({ baseURL });
  return (model: string): LanguageModel => ollama.chat(model);
}
