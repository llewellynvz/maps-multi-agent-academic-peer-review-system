export interface RubricCriterion {
  readonly index: number;
  readonly name: string;
  readonly summary: string;
}

// The canonical 15-criterion editorial rubric. Source of truth is knowledge/03_REVIEW_DECISION.md;
// this is the importable copy the app and engine share so scores can be labelled, not shown as bare numbers.
export const RUBRIC_CRITERIA: readonly RubricCriterion[] = [
  {
    index: 1,
    name: 'Title, abstract, and fit',
    summary: 'Title and abstract represent the work accurately and match journal scope and article type.',
  },
  {
    index: 2,
    name: 'Contribution and novelty',
    summary: 'Theoretical, empirical, methodological, or practical value beyond the literature.',
  },
  {
    index: 3,
    name: 'Construct clarity and theory',
    summary: 'Definition and stability of core constructs, and coherence of the framing.',
  },
  {
    index: 4,
    name: 'Literature and counterarguments',
    summary: 'Coverage of relevant recent literature, including work that cuts against the argument.',
  },
  {
    index: 5,
    name: 'Methodology and integrity',
    summary: 'The design can answer the question, with no unaddressed integrity signals.',
  },
  {
    index: 6,
    name: 'Measurement and trustworthiness',
    summary: 'Instruments, coding, operationalisation, and validity or trustworthiness evidence.',
  },
  {
    index: 7,
    name: 'Analysis quality and assumptions',
    summary: 'Appropriateness, assumption checks, and transparency of analytic choices.',
  },
  {
    index: 8,
    name: 'Robustness and alternative explanations',
    summary: 'Sensitivity checks and engagement with rival explanations.',
  },
  {
    index: 9,
    name: 'Results clarity and completeness',
    summary: 'Full, consistent reporting with uncertainty quantified.',
  },
  {
    index: 10,
    name: 'Discussion and claims',
    summary: 'Conclusions follow from the data, with causal language matched to the design.',
  },
  {
    index: 11,
    name: 'Limitations and boundaries',
    summary: 'Honest, specific limitations and boundary conditions.',
  },
  {
    index: 12,
    name: 'Transparency and reproducibility',
    summary: 'Data, code, materials, and protocol availability and documentation.',
  },
  {
    index: 13,
    name: 'Practical and scientific implications',
    summary: 'The stated implications actually follow from the evidence.',
  },
  {
    index: 14,
    name: 'Writing, scholarly tone, and COI',
    summary: 'Clarity, structure, professional tone, and conflict-of-interest disclosure.',
  },
  {
    index: 15,
    name: 'Overall decision readiness',
    summary: 'Proximity of the whole manuscript to a publishable state at this journal.',
  },
];

export function rubricCriterion(index: number): RubricCriterion | undefined {
  return RUBRIC_CRITERIA.find((criterion) => criterion.index === index);
}

export function rubricCriterionName(index: number): string {
  return rubricCriterion(index)?.name ?? `Criterion ${index}`;
}
