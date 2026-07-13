export type EnvSource = Record<string, string | undefined>;

export function stripQuotes(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.replace(/^"([\s\S]*)"$/, '$1');
}

export function getEnv(env: EnvSource, key: string): string | undefined {
  const stripped = stripQuotes(env[key]);
  if (stripped === undefined) {
    return undefined;
  }
  const trimmed = stripped.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function requireEnv(env: EnvSource, key: string): string {
  const value = getEnv(env, key);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
