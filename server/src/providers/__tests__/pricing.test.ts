import { afterEach, describe, expect, it } from 'vitest';
import { estimateCostUsd, hasPricing } from '../pricing';

afterEach(() => {
  delete process.env.MARA_PRICING_GPT_5_1;
});

describe('dispatch cost estimation', () => {
  it('prices a gpt-5.1 dispatch with cached tokens at the cached rate', () => {
    const cost = estimateCostUsd('gpt-5.1', {
      inputTokens: 2000,
      outputTokens: 100,
      cachedTokens: 1900,
      reasoningTokens: 0,
    });
    const raw = (100 * 0.625 + 1900 * 0.0625 + 100 * 5.0) / 1_000_000;
    expect(cost).toBe(Math.round(raw * 1_000_000) / 1_000_000);
  });

  it('returns zero for a model with no pricing entry', () => {
    expect(
      estimateCostUsd('qwen2:7b', { inputTokens: 500, outputTokens: 50, cachedTokens: 0, reasoningTokens: 0 }),
    ).toBe(0);
  });

  it('honours an env pricing override', () => {
    process.env.MARA_PRICING_GPT_5_1 = '1,0.1,10';
    const cost = estimateCostUsd('gpt-5.1', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    });
    expect(cost).toBe(1);
  });

  it('ignores a malformed override and falls back to the table', () => {
    process.env.MARA_PRICING_GPT_5_1 = 'not,valid';
    const cost = estimateCostUsd('gpt-5.1', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    });
    expect(cost).toBeCloseTo(0.625, 6);
  });

  it('rejects overrides without exactly three non-empty fields', () => {
    const tokens = { inputTokens: 0, outputTokens: 1_000_000, cachedTokens: 0, reasoningTokens: 0 };
    process.env.MARA_PRICING_GPT_5_1 = '1,,3';
    expect(estimateCostUsd('gpt-5.1', tokens)).toBe(5);
    process.env.MARA_PRICING_GPT_5_1 = '1,2,3,4';
    expect(estimateCostUsd('gpt-5.1', tokens)).toBe(5);
    process.env.MARA_PRICING_GPT_5_1 = '1,2,3';
    expect(estimateCostUsd('gpt-5.1', tokens)).toBe(3);
  });

  it('reports whether a model has a usable pricing entry', () => {
    expect(hasPricing('gpt-5.1')).toBe(true);
    expect(hasPricing('qwen2:7b')).toBe(false);
  });

  it('prices a gpt-5.6-sol dispatch at its own input/cached/output rates', () => {
    expect(hasPricing('gpt-5.6-sol')).toBe(true);
    const cost = estimateCostUsd('gpt-5.6-sol', {
      inputTokens: 2000,
      outputTokens: 100,
      cachedTokens: 1900,
      reasoningTokens: 0,
    });
    const raw = (100 * 5.0 + 1900 * 0.5 + 100 * 30.0) / 1_000_000;
    expect(cost).toBe(Math.round(raw * 1_000_000) / 1_000_000);
  });
});
