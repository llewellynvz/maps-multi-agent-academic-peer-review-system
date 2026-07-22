import type { DispatchTokens } from './dispatch';

interface ModelPricing {
  inputPerMillion: number;
  cachedPerMillion: number;
  outputPerMillion: number;
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  'gpt-5.1': { inputPerMillion: 0.625, cachedPerMillion: 0.0625, outputPerMillion: 5.0 },
  'gpt-5.4-mini': { inputPerMillion: 0.75, cachedPerMillion: 0.075, outputPerMillion: 4.5 },
  'gpt-5-mini': { inputPerMillion: 0.25, cachedPerMillion: 0.025, outputPerMillion: 2.0 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, cachedPerMillion: 0.1, outputPerMillion: 1.6 },
  'gpt-4o': { inputPerMillion: 2.5, cachedPerMillion: 1.25, outputPerMillion: 10.0 },
  'gpt-5.6-sol': { inputPerMillion: 5.0, cachedPerMillion: 0.5, outputPerMillion: 30.0 },
};

function pricingFor(model: string): ModelPricing | undefined {
  const override = process.env[`MARA_PRICING_${model.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (override !== undefined) {
    const parts = override.split(',');
    if (parts.length === 3 && parts.every((part) => part.trim() !== '')) {
      const [input, cached, output] = parts.map(Number);
      if ([input, cached, output].every((value) => Number.isFinite(value) && value! >= 0)) {
        return { inputPerMillion: input!, cachedPerMillion: cached!, outputPerMillion: output! };
      }
    }
  }
  return PRICING_TABLE[model];
}

export function hasPricing(model: string): boolean {
  return pricingFor(model) !== undefined;
}

export function estimateCostUsd(model: string, tokens: DispatchTokens): number {
  const pricing = pricingFor(model);
  if (pricing === undefined) {
    return 0;
  }
  const freshIn = Math.max(0, tokens.inputTokens - tokens.cachedTokens);
  const cost =
    (freshIn * pricing.inputPerMillion +
      tokens.cachedTokens * pricing.cachedPerMillion +
      tokens.outputTokens * pricing.outputPerMillion) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
