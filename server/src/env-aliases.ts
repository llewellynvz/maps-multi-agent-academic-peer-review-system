// The platform's settings are named MAPS_*. Deployments configured before the rename use MARA_*; each
// legacy variable is copied to its MAPS_ name when that name is unset, so an existing .env keeps working.
// An explicit MAPS_ value always wins.
export function applyLegacyEnvAliases(env: Record<string, string | undefined> = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('MARA_') || value === undefined) {
      continue;
    }
    const current = `MAPS_${key.slice('MARA_'.length)}`;
    if (env[current] === undefined || env[current] === '') {
      env[current] = value;
    }
  }
}

applyLegacyEnvAliases();
