import type { LanguageModel } from 'ai';

export type Role = 'frontier' | 'cheap' | 'local';

export type DispatchProvider = 'anthropic' | 'openai' | 'google' | 'local' | 'azure';

export interface ModelRef {
  role?: Role;
  providerName: DispatchProvider;
  model: string;
  languageModel: LanguageModel;
  isReasoning: boolean;
}
