const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

export function isLoopbackHost(hostHeader: string | null): boolean {
  try {
    const name = new URL(`http://${(hostHeader ?? '').trim()}`).hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    return LOOPBACK_HOSTS.includes(name);
  } catch {
    return false;
  }
}
