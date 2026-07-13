import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '../anthropic';
import { createGoogleProvider } from '../google';
import { createOllamaProvider } from '../ollama';
import { createOpenAiProvider } from '../openai';
import { createRegistry, isReasoningModel, type ProviderFactories } from '../registry';
import type { DispatchProvider } from '../types';

function sentinelModel(id: string): LanguageModel {
  return { __sentinel: id } as unknown as LanguageModel;
}

function fakeFactories(): { factories: ProviderFactories; calls: Record<DispatchProvider, string[]> } {
  const calls: Record<DispatchProvider, string[]> = {
    azure: [],
    openai: [],
    anthropic: [],
    google: [],
    local: [],
  };
  const make = (provider: DispatchProvider) => () => (model: string) => {
    calls[provider].push(model);
    return sentinelModel(`${provider}:${model}`);
  };
  return {
    calls,
    factories: {
      azure: make('azure'),
      openai: make('openai'),
      anthropic: make('anthropic'),
      google: make('google'),
      local: make('local'),
    },
  };
}

const env = {
  AZURE_FRONTIER_DEPLOYMENT: 'gpt-5.1',
  AZURE_CHEAP_DEPLOYMENT: 'gpt-5.4-mini',
};

describe('createRegistry role resolution', () => {
  it('resolves the frontier role to the Azure reasoning deployment', () => {
    const { factories, calls } = fakeFactories();
    const registry = createRegistry({ env, factories });

    const ref = registry.resolveRole('frontier');

    expect(ref.providerName).toBe('azure');
    expect(ref.model).toBe('gpt-5.1');
    expect(ref.isReasoning).toBe(true);
    expect(ref.role).toBe('frontier');
    expect(calls.azure).toEqual(['gpt-5.1']);
  });

  it('resolves the cheap role to the Azure mini deployment as a non-reasoning model', () => {
    const { factories } = fakeFactories();
    const registry = createRegistry({ env, factories });

    const ref = registry.resolveRole('cheap');

    expect(ref.providerName).toBe('azure');
    expect(ref.model).toBe('gpt-5.4-mini');
    expect(ref.isReasoning).toBe(false);
  });

  it('resolves the local role to the default Ollama model when unset', () => {
    const { factories, calls } = fakeFactories();
    const registry = createRegistry({ env, factories });

    const ref = registry.resolveRole('local');

    expect(ref.providerName).toBe('local');
    expect(ref.model).toBe('qwen2:7b');
    expect(ref.isReasoning).toBe(false);
    expect(calls.local).toEqual(['qwen2:7b']);
  });

  it('honours an explicit local model from OLLAMA_MODEL', () => {
    const { factories } = fakeFactories();
    const registry = createRegistry({ env: { ...env, OLLAMA_MODEL: 'llama3.2:3b' }, factories });

    expect(registry.resolveRole('local').model).toBe('llama3.2:3b');
  });
});

describe('isReasoningModel', () => {
  it('flags the frontier gpt-5 family and o-series but not mini variants', () => {
    expect(isReasoningModel('azure', 'gpt-5.1')).toBe(true);
    expect(isReasoningModel('azure', 'gpt-5.4-mini')).toBe(false);
    expect(isReasoningModel('openai', 'o3')).toBe(true);
    expect(isReasoningModel('azure', 'gpt-4o')).toBe(false);
    expect(isReasoningModel('local', 'qwen2:7b')).toBe(false);
  });
});

describe('provider factories', () => {
  it('build a language model when the credential is present', () => {
    expect(() => createAnthropicProvider({ ANTHROPIC_API_KEY: 'sk-test' })('claude-3-5-haiku')).not.toThrow();
    expect(() => createOpenAiProvider({ OPENAI_API_KEY: 'sk-test' })('gpt-4o-mini')).not.toThrow();
    expect(() => createGoogleProvider({ GOOGLE_API_KEY: 'g-test' })('gemini-1.5-flash')).not.toThrow();
    expect(() => createOllamaProvider({ OLLAMA_BASE_URL: 'http://127.0.0.1:11800/api' })('qwen2:7b')).not.toThrow();
  });

  it('throw a named error when the credential env var is missing', () => {
    expect(() => createAnthropicProvider({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createOpenAiProvider({})).toThrow(/OPENAI_API_KEY/);
    expect(() => createGoogleProvider({})).toThrow(/GOOGLE_API_KEY/);
    expect(() => createOllamaProvider({})).toThrow(/OLLAMA_BASE_URL/);
  });

  it('does not construct any provider until a role is resolved', () => {
    const spy = vi.fn();
    const factories: ProviderFactories = {
      azure: () => {
        spy();
        return () => sentinelModel('azure');
      },
      openai: () => () => sentinelModel('openai'),
      anthropic: () => () => sentinelModel('anthropic'),
      google: () => () => sentinelModel('google'),
      local: () => () => sentinelModel('local'),
    };
    createRegistry({ env, factories });
    expect(spy).not.toHaveBeenCalled();
  });
});
