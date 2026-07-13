import { createAzure } from '@ai-sdk/azure';
import { ClientCertificateCredential } from '@azure/identity';
import type { LanguageModel } from 'ai';
import { type EnvSource, requireEnv } from './env';

const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface AzureToken {
  token: string;
  expiresOnTimestamp: number;
}

export type TokenFetcher = () => Promise<AzureToken>;

export interface CachedTokenProviderOptions {
  fetchToken: TokenFetcher;
  now?: () => number;
  refreshMarginMs?: number;
}

export interface CachedTokenProvider {
  getToken: () => Promise<string>;
  refreshCount: () => number;
}

export function createCachedTokenProvider(options: CachedTokenProviderOptions): CachedTokenProvider {
  const now = options.now ?? Date.now;
  const margin = options.refreshMarginMs ?? REFRESH_MARGIN_MS;
  let cached: AzureToken | null = null;
  let refreshes = 0;

  return {
    async getToken(): Promise<string> {
      const current = now();
      if (cached === null || current >= cached.expiresOnTimestamp - margin) {
        cached = await options.fetchToken();
        refreshes += 1;
      }
      return cached.token;
    },
    refreshCount: (): number => refreshes,
  };
}

export function createCertificateTokenFetcher(env: EnvSource): TokenFetcher {
  const tenantId = requireEnv(env, 'AZURE_TENANT_ID');
  const clientId = requireEnv(env, 'AZURE_CLIENT_ID');
  const certificatePath = requireEnv(env, 'AZURE_CLIENT_CERT_PEM_PATH');
  const credential = new ClientCertificateCredential(tenantId, clientId, { certificatePath });

  return async (): Promise<AzureToken> => {
    const result = await credential.getToken(COGNITIVE_SCOPE);
    if (result === null) {
      throw new Error('Azure credential returned no access token');
    }
    return { token: result.token, expiresOnTimestamp: result.expiresOnTimestamp };
  };
}

export interface AzureProvider {
  chat: (deployment: string) => LanguageModel;
  tokenProvider: CachedTokenProvider;
}

export interface CreateAzureProviderOptions {
  env: EnvSource;
  fetchToken?: TokenFetcher;
  now?: () => number;
}

export function createAzureProvider(options: CreateAzureProviderOptions): AzureProvider {
  const { env } = options;
  const endpoint = requireEnv(env, 'AZURE_OPENAI_ENDPOINT').replace(/\/+$/, '');
  const apiVersion = requireEnv(env, 'AZURE_OPENAI_API_VERSION');
  const fetchToken = options.fetchToken ?? createCertificateTokenFetcher(env);
  const tokenProvider = createCachedTokenProvider({ fetchToken, now: options.now });

  const azure = createAzure({
    baseURL: `${endpoint}/openai`,
    apiVersion,
    useDeploymentBasedUrls: true,
    tokenProvider: () => tokenProvider.getToken(),
  });

  return {
    chat: (deployment: string): LanguageModel => azure.chat(deployment),
    tokenProvider,
  };
}
