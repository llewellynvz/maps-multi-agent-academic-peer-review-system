import { describe, expect, it } from 'vitest';
import { safeRedirect } from '../redirect';

const origin = 'https://mara.example';

describe('safeRedirect', () => {
  it('keeps a same-origin path with its query and hash', () => {
    expect(safeRedirect('/reviews/abc/run?x=1#top', origin)).toBe('/reviews/abc/run?x=1#top');
  });

  it('refuses off-site, protocol-relative and script destinations', () => {
    for (const raw of ['https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'javascript:alert(1)', null]) {
      expect(safeRedirect(raw, origin)).toBe('/');
    }
  });
});
