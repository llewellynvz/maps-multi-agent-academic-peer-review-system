import { describe, expect, it } from 'vitest';
import { hostAllowed } from '../host';

describe('hostAllowed', () => {
  it('accepts the loopback names the app is published on, with or without a port', () => {
    for (const host of ['127.0.0.1:3100', 'localhost:3100', 'LOCALHOST', '[::1]:3100', '127.0.0.1']) {
      expect(hostAllowed(host, undefined)).toBe(true);
    }
  });

  it('refuses any other host, which is what a DNS-rebinding page sends', () => {
    for (const host of ['evil.example:3100', 'evil.example', '127.0.0.1.evil.example:3100', '192.168.1.20:3100', '', null]) {
      expect(hostAllowed(host, undefined)).toBe(false);
    }
  });

  it('accepts hosts the operator lists explicitly, case-insensitively and ignoring spaces', () => {
    expect(hostAllowed('maps.lab.example:443', 'Maps.Lab.Example, 192.168.1.20')).toBe(true);
    expect(hostAllowed('192.168.1.20:3100', 'maps.lab.example, 192.168.1.20')).toBe(true);
    expect(hostAllowed('other.example', 'maps.lab.example')).toBe(false);
  });
});
