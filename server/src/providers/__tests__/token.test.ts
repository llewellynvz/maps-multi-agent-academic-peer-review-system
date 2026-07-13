import { describe, expect, it } from 'vitest';
import { type AzureToken, createCachedTokenProvider } from '../azure';

function fetcherSequence(tokens: AzureToken[]): { fetch: () => Promise<AzureToken>; calls: () => number } {
  let index = 0;
  return {
    fetch: async (): Promise<AzureToken> => {
      const token = tokens[Math.min(index, tokens.length - 1)];
      index += 1;
      if (token === undefined) {
        throw new Error('no token configured');
      }
      return token;
    },
    calls: (): number => index,
  };
}

describe('createCachedTokenProvider', () => {
  it('fetches once and reuses a token that is still fresh', async () => {
    let clock = 1_000;
    const expiry = clock + 60 * 60 * 1000;
    const source = fetcherSequence([{ token: 'first', expiresOnTimestamp: expiry }]);
    const provider = createCachedTokenProvider({ fetchToken: source.fetch, now: () => clock });

    expect(await provider.getToken()).toBe('first');
    clock += 10 * 60 * 1000;
    expect(await provider.getToken()).toBe('first');

    expect(source.calls()).toBe(1);
    expect(provider.refreshCount()).toBe(1);
  });

  it('refreshes proactively once inside the five minute margin before expiry', async () => {
    let clock = 1_000;
    const expiry = clock + 10 * 60 * 1000;
    const source = fetcherSequence([
      { token: 'first', expiresOnTimestamp: expiry },
      { token: 'second', expiresOnTimestamp: clock + 60 * 60 * 1000 },
    ]);
    const provider = createCachedTokenProvider({ fetchToken: source.fetch, now: () => clock });

    expect(await provider.getToken()).toBe('first');

    clock = expiry - 5 * 60 * 1000;
    expect(await provider.getToken()).toBe('second');

    expect(source.calls()).toBe(2);
    expect(provider.refreshCount()).toBe(2);
  });

  it('does not refresh while more than the margin remains before expiry', async () => {
    let clock = 0;
    const expiry = 10 * 60 * 1000;
    const source = fetcherSequence([
      { token: 'first', expiresOnTimestamp: expiry },
      { token: 'second', expiresOnTimestamp: 60 * 60 * 1000 },
    ]);
    const provider = createCachedTokenProvider({ fetchToken: source.fetch, now: () => clock });

    expect(await provider.getToken()).toBe('first');
    clock = expiry - 5 * 60 * 1000 - 1;
    expect(await provider.getToken()).toBe('first');

    expect(provider.refreshCount()).toBe(1);
  });
});
