import type { StatusTone } from './format';

export interface LensInfo {
  display: string;
  purpose: string;
}

export const LENS_INFO: Record<string, LensInfo> = {
  NOV: { display: 'Novelty', purpose: 'Weighs how much the study adds beyond what is already known.' },
  ARG: { display: 'Argumentation', purpose: 'Checks that the claims follow from the evidence the paper presents.' },
  THEO: { display: 'Theoretical coherence', purpose: 'Tests whether the theory is consistent and applied correctly.' },
  METH: { display: 'Methods and design', purpose: 'Assesses whether the design can actually answer the research question.' },
  PRAC: { display: 'Practical significance', purpose: 'Judges whether the findings matter in real settings, not only statistically.' },
  ETH: { display: 'Ethics, equity, and participants', purpose: 'Reviews consent, fairness, and how participants were treated.' },
  STAT: { display: 'Statistical', purpose: 'Examines whether the analyses and their reporting are sound.' },
  MEAS: { display: 'Measurement and psychometrics', purpose: 'Checks that the measures are valid and reliable for their use.' },
  QUAL: { display: 'Qualitative', purpose: 'Evaluates the rigour and trustworthiness of qualitative work.' },
  MIX: { display: 'Mixed methods', purpose: 'Assesses how well the qualitative and quantitative strands fit together.' },
  CAUS: { display: 'Causal inference', purpose: 'Tests whether the data support the cause-and-effect claims made.' },
  MAP: { display: 'Manuscript mapping', purpose: 'Traces the structure of the manuscript and the claims it makes.' },
  CTX: { display: 'Field context', purpose: 'Places the study against current work and norms in its field.' },
  RPT: { display: 'Reporting standards', purpose: 'Checks the paper against the reporting standards for its design.' },
  RPX: { display: 'Reproducibility', purpose: 'Assesses whether others could reproduce the results from what is shared.' },
  SWM: { display: 'Reviewer ensemble', purpose: 'Stress-tests findings across a simulated range of reviewer perspectives.' },
  SIM: { display: 'Integrity screening', purpose: 'Flags text-similarity signals for editorial attention.' },
  AIC: { display: 'AI-content screening', purpose: 'Flags signals of undisclosed generated text for editorial attention.' },
  REF: { display: 'Reference audit', purpose: 'Verifies that references exist and support the claims that cite them.' },
  SAN: { display: 'Manuscript screening', purpose: 'Screens the file for hidden instructions and tampering before review.' },
};

export const LENS_FALLBACK: LensInfo = { display: 'Review', purpose: 'General review finding' };

export function prefixOf(findingId: string): string {
  const match = /^[A-Za-z]+/.exec(findingId.trim());
  return (match?.[0] ?? '').toUpperCase();
}

export function lensInfo(findingId: string): LensInfo {
  return LENS_INFO[prefixOf(findingId)] ?? LENS_FALLBACK;
}

export type Severity = 'none' | 'minor' | 'moderate' | 'major' | 'fatal';

export interface SeverityInfo {
  label: string;
  tone: StatusTone;
  meaning: string;
}

export const SEVERITY_INFO: Record<Severity, SeverityInfo> = {
  none: { label: 'None', tone: 'success', meaning: 'No issue was found on this point.' },
  minor: { label: 'Minor', tone: 'neutral', meaning: 'A small issue that is quick to address.' },
  moderate: { label: 'Moderate', tone: 'warn', meaning: 'A clear issue that should be resolved before acceptance.' },
  major: { label: 'Major', tone: 'fail', meaning: 'A serious issue that must be resolved for the work to hold.' },
  fatal: { label: 'Fatal', tone: 'fail', meaning: 'A flaw that undermines the study as it currently stands.' },
};
