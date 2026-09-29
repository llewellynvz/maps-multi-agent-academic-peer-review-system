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

const ROLE_PROVIDERS = new Set<DispatchProvider>(['azure', 'openai', 'anthropic', 'google', 'local']);

// Azure stays the default, but a role can be pointed at any provider with MAPS_<ROLE>_PROVIDER and
// MAPS_<ROLE>_MODEL, so a key added in Settings (OpenAI, Anthropic, Google) can actually carry a review.
function roleConfig(env: EnvSource, role: 'FRONTIER' | 'CHEAP'): RoleConfig {
  const provider = (getEnv(env, `MAPS_${role}_PROVIDER`) ?? 'azure').toLowerCase() as DispatchProvider;
  if (!ROLE_PROVIDERS.has(provider)) {
    throw new Error(`MAPS_${role}_PROVIDER must be one of ${[...ROLE_PROVIDERS].join(', ')}; got ${provider}`);
  }
  const model =
    getEnv(env, `MAPS_${role}_MODEL`) ??
    (provider === 'azure' ? requireEnv(env, `AZURE_${role}_DEPLOYMENT`) : requireEnv(env, `MAPS_${role}_MODEL`));
  return { provider, model };
}

export function readRoleConfigs(env: EnvSource): Record<Role, RoleConfig> {
  return {
    frontier: roleConfig(env, 'FRONTIER'),
    cheap: roleConfig(env, 'CHEAP'),
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

// 'xhigh' arrived with gpt-5.1-codex-max and the gpt-5.2+ family; gpt-5, gpt-5.1 and the o-series reject
// it and top out at 'high'. Sending the wrong ceiling turns every call into a 400.
export function maxReasoningEffort(model: string): 'high' | 'xhigh' {
  const minor = /^gpt-5\.(\d+)/i.exec(model)?.[1];
  if (minor !== undefined && Number(minor) >= 2) {
    return 'xhigh';
  }
  return /codex-max/i.test(model) ? 'xhigh' : 'high';
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

// Rebuilds the registry when its environment changes, so a provider key saved in Settings reaches the
// long-running worker on the next dispatch instead of waiting for a restart. `fingerprint` must be cheap.
export function createRefreshingRegistry(options: {
  fingerprint: () => string;
  env: () => EnvSource;
}): Registry {
  let current: { fingerprint: string; registry: Registry } | null = null;
  const registry = (): Registry => {
    const fingerprint = options.fingerprint();
    if (current === null || current.fingerprint !== fingerprint) {
      current = { fingerprint, registry: createRegistry({ env: options.env() }) };
    }
    return current.registry;
  };
  return {
    resolveRole: (role) => registry().resolveRole(role),
    resolveModel: (provider, model) => registry().resolveModel(provider, model),
  };
}
