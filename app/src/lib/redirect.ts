// Only a same-origin path may be the post-login destination: `from` arrives in the URL, so an absolute,
// protocol-relative or `javascript:` value would turn the login form into an open redirect or script sink.
// Prefix checks alone are not enough (the URL parser drops tabs and newlines, so "/\t/evil.example" is
// protocol-relative), so the value is resolved and must land on this origin.
export function safeRedirect(raw: string | null, origin: string): string {
  if (raw === null || !raw.startsWith('/')) {
    return '/';
  }
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}
