const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

function hostname(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  } catch {
    return '';
  }
}

export function hostAllowed(hostHeader: string | null, extraHosts: string | undefined): boolean {
  if (hostHeader === null || hostHeader === '') {
    return false;
  }
  const allowed = [...LOOPBACK_HOSTS, ...(extraHosts ?? '').split(',').map((h) => h.trim().toLowerCase())];
  const name = hostname(hostHeader);
  return name !== '' && allowed.includes(name);
}
