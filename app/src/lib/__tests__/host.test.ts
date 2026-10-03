import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from '../host';

describe('isLoopbackHost', () => {
  it('accepts the loopback names the app is published on, with or without a port', () => {
    for (const host of ['127.0.0.1:3100', 'localhost:3100', 'LOCALHOST', '[::1]:3100', '127.0.0.1']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it('refuses any other host, which is what a DNS-rebinding page sends', () => {
    for (const host of ['evil.example:3100', 'evil.example', '127.0.0.1.evil.example:3100', '192.168.1.20:3100']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it('refuses a missing or unparseable Host header, including one shaped like a URL', () => {
    for (const host of ['', ' ', ':3100', '[', 'x://localhost', 'localhost@evil.example', null]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});
