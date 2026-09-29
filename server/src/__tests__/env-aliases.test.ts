import { describe, expect, it } from 'vitest';
import { applyLegacyEnvAliases } from '../env-aliases';

describe('applyLegacyEnvAliases', () => {
  it('copies a legacy MARA_ setting to its MAPS_ name', () => {
    const env: Record<string, string | undefined> = { MARA_MASTER_KEY: 'abc', MARA_PRICING_GPT_5_1: '1,2,3' };
    applyLegacyEnvAliases(env);
    expect(env.MAPS_MASTER_KEY).toBe('abc');
    expect(env.MAPS_PRICING_GPT_5_1).toBe('1,2,3');
  });

  it('never overrides an explicit MAPS_ value, but fills a blank one', () => {
    const env: Record<string, string | undefined> = { MARA_PORT: '3100', MAPS_PORT: '4000', MARA_BIND: '0.0.0.0', MAPS_BIND: '' };
    applyLegacyEnvAliases(env);
    expect(env.MAPS_PORT).toBe('4000');
    expect(env.MAPS_BIND).toBe('0.0.0.0');
  });
});
