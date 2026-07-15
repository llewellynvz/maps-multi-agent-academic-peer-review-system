import type { CurrentFinding } from '../ledger';
import type { Recommendation } from '@mara/shared';

const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  accept: 'Accept',
  minor_revision: 'Minor revision',
  major_revision: 'Major revision',
  reject_and_resubmit: 'Reject and resubmit',
  reject: 'Reject',
};

const SIGNAL_FRAMING =
  'These are editorial signals for the handling editor, not determinations of misconduct. Each should be checked against the original files, journal policy, and any author explanation where appropriate.';

const PRIOR_LABEL: Record<string, string> = {
  accept: 'Accept',
  'minor-revision': 'Minor revision',
  'major-revision': 'Major revision',
  'reject-and-resubmit': 'Reject and resubmit',
  reject: 'Reject',
};

const ALIGNMENT_SENTENCE: Record<string, string> = {
  supported: 'The evidence supports this preliminary assessment.',
  partially_supported: 'The evidence partially supports this preliminary assessment, diverging on severity or category.',
  contradicted: 'The evidence contradicts this preliminary assessment.',
};

export interface PriorStressNotesInput {
  prior: string;
  caseFor: string;
  caseAgainst: string;
  alignment: 'supported' | 'partially_supported' | 'contradicted';
}

export interface PrivateNotesInput {
  recommendation: Recommendation;
  recommendationConfidence: number;
  currentFindings: CurrentFinding[];
  strongestMinorityReport: string;
  editorSummaryMarkdown?: string;
  priorStressTest?: PriorStressNotesInput;
}

export interface AssembledPrivateNotes {
  markdown: string;
  referencedIds: string[];
}

export function assemblePrivateNotes(input: PrivateNotesInput): AssembledPrivateNotes {
  const editorOnly = input.currentFindings.filter((finding) => finding.scope === 'editor_only');
  const referencedIds = editorOnly.map((finding) => finding.id);

  const lines: string[] = [];
  lines.push('# Reviewer\'s private notes');
  lines.push('');
  lines.push('## Recommendation');
  lines.push(
    `${RECOMMENDATION_LABEL[input.recommendation]} at confidence ${input.recommendationConfidence.toFixed(2)}.`,
  );
  lines.push('');
  if (input.priorStressTest !== undefined) {
    const prior = input.priorStressTest;
    lines.push('## Preliminary assessment, stress-tested');
    lines.push(
      `The reviewer's preliminary assessment was ${PRIOR_LABEL[prior.prior] ?? prior.prior}. It was withheld from the review and tested against the evidence only after the recommendation was set.`,
    );
    lines.push(`Case for: ${prior.caseFor.trim()}`);
    lines.push(`Case against: ${prior.caseAgainst.trim()}`);
    lines.push(ALIGNMENT_SENTENCE[prior.alignment] ?? `Alignment: ${prior.alignment}.`);
    lines.push('');
  }
  if (input.editorSummaryMarkdown !== undefined && input.editorSummaryMarkdown.trim().length > 0) {
    lines.push('## Editorial synthesis');
    lines.push(input.editorSummaryMarkdown.trim());
    lines.push('');
  }
  lines.push('## Editorial signals');
  lines.push(SIGNAL_FRAMING);
  lines.push('');
  if (editorOnly.length === 0) {
    lines.push('No editor-only signals were raised for this manuscript.');
  } else {
    for (const finding of editorOnly) {
      lines.push(`### ${finding.id} (${finding.type})`);
      lines.push(`Signal (${finding.severity}, confidence ${finding.confidence.toFixed(2)}): ${finding.claim}`);
      lines.push(`Anchor: ${finding.manuscriptAnchor}.`);
      if (finding.recommendedAction !== null && finding.recommendedAction.trim().length > 0) {
        lines.push(`Editorial check: ${finding.recommendedAction}`);
      }
      lines.push('');
    }
  }
  lines.push('## Preserved alternative reading');
  lines.push(
    input.strongestMinorityReport.trim().length > 0
      ? input.strongestMinorityReport.trim()
      : 'The swarm surfaced no minority position that survived to the final round.',
  );
  lines.push('');

  return { markdown: lines.join('\n'), referencedIds };
}

export function appendRunAudit(privateNotesMarkdown: string, runAudit: string): string {
  return `${privateNotesMarkdown}\n## Run audit\n${runAudit}\n`;
}
