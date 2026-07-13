import { createAnthropicProvider } from './anthropic';
import { type CreateAzureProviderOptions, createAzureProvider } from './azure';
import { type EnvSource, getEnv, requireEnv } from './env';
import { createGoogleProvider } from './google';
import { createOllamaProvider, type ModelFactory } from './ollama';
import { createOpenAiProvider } from './openai';
import type { DispatchProvider, ModelRef, Role } from './types';

export interface RoleConfig {
  provider: DispatchProvider;
  model: string;
}

const DEFAULT_LOCAL_MODEL = 'qwen2:7b';

export function readRoleConfigs(env: EnvSource): Record<Role, RoleConfig> {
  return {
    frontier: { provider: 'azure', model: requireEnv(env, 'AZURE_FRONTIER_DEPLOYMENT') },
    cheap: { provider: 'azure', model: requireEnv(env, 'AZURE_CHEAP_DEPLOYMENT') },
    local: { provider: 'local', model: getEnv(env, 'OLLAMA_MODEL') ?? DEFAULT_LOCAL_MODEL },
  };
}

export function isReasoningModel(provider: DispatchProvider, model: string): boolean {
  if (provider !== 'azure' && provider !== 'openai') {
    return false;
  }
  if (/-(mini|nano)/i.test(model)) {
    return false;
  }
  return /^gpt-5/i.test(model) || /^o[13]/i.test(model);
}

export type ProviderFactories = Record<DispatchProvider, () => ModelFactory>;

function memoize(factory: () => ModelFactory): () => ModelFactory {
  let cached: ModelFactory | undefined;
  return (): ModelFactory => {
    if (cached === undefined) {
      cached = factory();
    }
    return cached;
  };
}

export function createDefaultProviderFactories(
  env: EnvSource,
  azureOptions?: Omit<CreateAzureProviderOptions, 'env'>,
): ProviderFactories {
  return {
    azure: memoize(() => createAzureProvider({ env, ...azureOptions }).chat),
    local: memoize(() => createOllamaProvider(env)),
    anthropic: memoize(() => createAnthropicProvider(env)),
    openai: memoize(() => createOpenAiProvider(env)),
    google: memoize(() => createGoogleProvider(env)),
  };
}

export interface Registry {
  resolveRole: (role: Role) => ModelRef;
  resolveModel: (provider: DispatchProvider, model: string) => ModelRef;
}

export interface CreateRegistryOptions {
  env: EnvSource;
  factories?: ProviderFactories;
  roleConfigs?: Record<Role, RoleConfig>;
}

export function createRegistry(options: CreateRegistryOptions): Registry {
  const factories = options.factories ?? createDefaultProviderFactories(options.env);
  const roleConfigs = options.roleConfigs ?? readRoleConfigs(options.env);

  const resolveModel = (provider: DispatchProvider, model: string): ModelRef => ({
    providerName: provider,
    model,
    languageModel: factories[provider]()(model),
    isReasoning: isReasoningModel(provider, model),
  });

  return {
    resolveModel,
    resolveRole: (role: Role): ModelRef => {
      const config = roleConfigs[role];
      return { role, ...resolveModel(config.provider, config.model) };
    },
  };
}
