import type { Finding } from '@mara/shared';

export function sanitiseSupersedes(findings: Finding[], knownIds: Set<string>): Finding[] {
  return findings.map((finding) =>
    finding.supersedes !== null && !knownIds.has(finding.supersedes) ? { ...finding, supersedes: null } : finding,
  );
}
