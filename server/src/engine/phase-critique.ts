import { sql } from 'drizzle-orm';
import type {
  CitationAuditorOutput,
  ClaimDesignAnalysis,
  FieldContextScoutOutput,
  Finding,
  IntegrityScreenerOutput,
  ManuscriptStructure,
  PhaseCriticDefect,
  PhaseCriticOutput,
  SpecialistReviewerOutput,
} from '@mara/shared';
import { getCurrentFindings } from '../ledger';
import { getReviewOptions, insertEvent } from '../workflow/repo';
import { readArtefact } from './artefacts';
import { loadEngineContext, manuscriptDigest } from './context';
import { runAgent } from './dispatch-agent';
import { type LensDef, matchLens, normalisePreset } from './lenses';
import { mergeFindingsOnce } from './merge';
import { DispatchPauseError, type EngineDeps } from './phases-shared';

export interface PhaseCritiqueInput {
  label: string;
  content: string;
}

export type CritiquePhase = 'phase_1' | 'phase_2' | 'phase_3' | 'phase_4' | 'phase_5' | 'phase_6';

const MAX_REDISPATCHES_PER_RUN = 2;

interface IntegrityClusterRoute {
  name: string;
  prefixes: string[];
}

const INTEGRITY_CLUSTERS: IntegrityClusterRoute[] = [
  { name: 'reporting-and-reproducibility', prefixes: ['RPT', 'RPX'] },
  { name: 'consistency-and-figures', prefixes: ['CON', 'FIG'] },
  { name: 'similarity-and-ai-content', prefixes: ['SIM', 'AIC'] },
];

function routeIntegrityPrefix(lens: string, allowed: string[]): string {
  const upper = lens.toUpperCase();
  for (const prefix of allowed) {
    if (upper.includes(prefix)) {
      return prefix;
    }
  }
  return allowed[0] ?? 'CON';
}

function sanitiseSupersedes(findings: Finding[], knownIds: Set<string>): Finding[] {
  return findings.map((finding) =>
    finding.supersedes !== null && !knownIds.has(finding.supersedes) ? { ...finding, supersedes: null } : finding,
  );
}

function priorRedispatchCount(deps: EngineDeps, reviewId: string): number {
  const rows = deps.db.all(
    sql`SELECT 1 FROM review_events WHERE review_id = ${reviewId} AND kind = 'phase_critique'
        AND json_extract(payload_json, '$.redispatched') = 1`,
  );
  return rows.length;
}

function critiqueRecorded(deps: EngineDeps, reviewId: string, phase: CritiquePhase): boolean {
  const rows = deps.db.all(
    sql`SELECT 1 FROM review_events WHERE review_id = ${reviewId} AND kind = 'phase_critique' AND phase = ${phase} LIMIT 1`,
  );
  return rows.length > 0;
}

function headlineFor(materialCount: number, redispatched: boolean, targetLabel: string | null): string {
  const gaps = `${materialCount} material ${materialCount === 1 ? 'gap' : 'gaps'}`;
  if (redispatched && targetLabel !== null) {
    return `Phase critic found ${gaps}; re-dispatched the ${targetLabel}`;
  }
  if (materialCount > 0) {
    return `Phase critic logged ${gaps} without re-dispatch`;
  }
  return 'Phase critic passed the phase outputs';
}

function matchIntegrityCluster(target: string | null): IntegrityClusterRoute | null {
  if (target === null) {
    return null;
  }
  const tokens = target
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((token) => token.length > 0);
  for (const cluster of INTEGRITY_CLUSTERS) {
    const nameTokens = cluster.name
      .toUpperCase()
      .split('-')
      .filter((token) => token !== 'AND');
    if (
      cluster.prefixes.some((prefix) => tokens.includes(prefix)) ||
      nameTokens.some((token) => tokens.includes(token))
    ) {
      return cluster;
    }
  }
  return null;
}

function matchScoutTarget(target: string | null): 'field-context-scout' | 'citation-auditor' | null {
  if (target === null) {
    return null;
  }
  const lower = target.toLowerCase();
  if (lower.includes('scout') || lower.includes('context') || lower.includes('ctx') || lower.includes('field')) {
    return 'field-context-scout';
  }
  if (lower.includes('citation') || lower.includes('auditor') || lower.includes('ref')) {
    return 'citation-auditor';
  }
  return null;
}

async function redispatchSpecialist(
  deps: EngineDeps,
  reviewId: string,
  n: string,
  lens: LensDef,
  fixInstruction: string,
): Promise<void> {
  const digest = manuscriptDigest(loadEngineContext(deps.db, reviewId).sectionMap);
  const mine = getCurrentFindings(deps.db, reviewId).filter((finding) => finding.id.startsWith(`REV-${lens.prefix}-`));
  const result = await runAgent<SpecialistReviewerOutput>(deps, {
    reviewId,
    phase: 'phase_3',
    agent: 'specialist-reviewer',
    artefactName: `p${n}-critfix-${lens.prefix}`,
    assembleInput: {
      lens: lens.display,
      manuscriptExcerpt: digest,
      artefacts: [
        { label: 'Your prior findings (canonical ledger ids)', content: JSON.stringify(mine, null, 2) },
        { label: 'Phase-critic instruction', content: fixInstruction },
      ],
      routingNote: `Adversarial phase-critic re-dispatch for ${lens.display} (REV-${lens.prefix}). ${fixInstruction} In "findings" return only the corrected or new findings; an update sets supersedes to the existing canonical id named in the instruction. challengeRound may be null.`,
    },
  });
  const knownIds = new Set(getCurrentFindings(deps.db, reviewId).map((finding) => finding.id));
  const sanitised = sanitiseSupersedes(result.findings, knownIds);
  if (sanitised.length > 0) {
    mergeFindingsOnce(deps.db, {
      reviewId,
      lensPrefix: lens.prefix,
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: sanitised,
      marker: `p${n}-critfix-${lens.prefix}`,
    });
  }
}

async function redispatchIntegrity(
  deps: EngineDeps,
  reviewId: string,
  phase: CritiquePhase,
  n: string,
  cluster: IntegrityClusterRoute,
  fixInstruction: string,
): Promise<void> {
  const ctx = loadEngineContext(deps.db, reviewId);
  const analystA = readArtefact<ManuscriptStructure>(reviewId, 'p1-analyst-a');
  const analystB = readArtefact<ClaimDesignAnalysis>(reviewId, 'p1-analyst-b');
  const result = await runAgent<IntegrityScreenerOutput>(deps, {
    reviewId,
    phase,
    agent: 'integrity-screener',
    artefactName: `p${n}-critfix-${cluster.name}`,
    assembleInput: {
      parseQuality: ctx.parseQuality,
      manuscriptExcerpt: manuscriptDigest(ctx.sectionMap),
      artefacts: [
        { label: 'Manuscript map', content: JSON.stringify(analystA.manuscriptMap) },
        { label: 'Figure and table inventory', content: JSON.stringify(analystA.figureTableInventory) },
        { label: 'Claim-evidence matrix', content: JSON.stringify(analystB.claimEvidenceMatrix) },
        { label: 'Phase-critic instruction', content: fixInstruction },
      ],
      routingNote: `Adversarial phase-critic re-dispatch, integrity cluster "${cluster.name}", rubrics ${cluster.prefixes
        .map((prefix) => `REV-${prefix}`)
        .join(' and ')}. ${fixInstruction} Findings are editorial signals, never verdicts; a serious signal is editor-only. Set each finding's lens to its rubric code and prefix its id REV-<rubric>.`,
    },
  });
  const knownIds = new Set(getCurrentFindings(deps.db, reviewId).map((finding) => finding.id));
  const groups = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const prefix = routeIntegrityPrefix(finding.lens, cluster.prefixes);
    const enforced: Finding =
      (finding.severity === 'major' || finding.severity === 'fatal') && finding.scope !== 'editor-only'
        ? { ...finding, scope: 'editor-only' }
        : finding;
    const bucket = groups.get(prefix) ?? [];
    bucket.push(enforced);
    groups.set(prefix, bucket);
  }
  for (const [prefix, fragments] of groups) {
    mergeFindingsOnce(deps.db, {
      reviewId,
      lensPrefix: prefix,
      phase,
      agent: 'integrity-screener',
      fragments: sanitiseSupersedes(fragments, knownIds),
      marker: `p${n}-critfix-${cluster.name}-${prefix}`,
    });
  }
}

async function redispatchContext(
  deps: EngineDeps,
  reviewId: string,
  phase: CritiquePhase,
  n: string,
  target: 'field-context-scout' | 'citation-auditor',
  fixInstruction: string,
): Promise<void> {
  const ctx = loadEngineContext(deps.db, reviewId);
  const analystB = readArtefact<ClaimDesignAnalysis>(reviewId, 'p1-analyst-b');
  const matrixJson = JSON.stringify(analystB.claimEvidenceMatrix);
  if (target === 'field-context-scout') {
    const result = await runAgent<FieldContextScoutOutput>(deps, {
      reviewId,
      phase,
      agent: 'field-context-scout',
      artefactName: `p${n}-critfix-context`,
      assembleInput: {
        parseQuality: ctx.parseQuality,
        manuscriptExcerpt: manuscriptDigest(ctx.sectionMap),
        artefacts: [{ label: 'Claim-evidence matrix', content: matrixJson }],
        routingNote: `Adversarial phase-critic re-dispatch of the field-context dossier. ${fixInstruction} Work from the manuscript and the provided context only; where a comparator would need retrieval, record it as not performable rather than inventing a source. Prefix findings REV-CTX.`,
      },
    });
    const knownIds = new Set(getCurrentFindings(deps.db, reviewId).map((finding) => finding.id));
    mergeFindingsOnce(deps.db, {
      reviewId,
      lensPrefix: 'CTX',
      phase,
      agent: 'field-context-scout',
      fragments: sanitiseSupersedes(result.findings, knownIds),
      marker: `p${n}-critfix-context`,
    });
    return;
  }
  const result = await runAgent<CitationAuditorOutput>(deps, {
    reviewId,
    phase,
    agent: 'citation-auditor',
    artefactName: `p${n}-critfix-citations`,
    assembleInput: {
      parseQuality: ctx.parseQuality,
      artefacts: [{ label: 'Claim-evidence matrix', content: matrixJson }],
      routingNote: `Adversarial phase-critic re-dispatch of the citation audit. ${fixInstruction} Judge only whether each reference supports the claim that cites it and audit reference-list hygiene; do not assert existence on your own. Prefix findings REV-REF.`,
    },
  });
  const knownIds = new Set(getCurrentFindings(deps.db, reviewId).map((finding) => finding.id));
  mergeFindingsOnce(deps.db, {
    reviewId,
    lensPrefix: 'REF',
    phase,
    agent: 'citation-auditor',
    fragments: sanitiseSupersedes(result.findings, knownIds),
    marker: `p${n}-critfix-citations`,
  });
}

async function executeRedispatch(
  deps: EngineDeps,
  reviewId: string,
  phase: CritiquePhase,
  n: string,
  materialDefects: PhaseCriticDefect[],
): Promise<string | null> {
  if (phase === 'phase_3') {
    for (const defect of materialDefects) {
      const lens = matchLens(defect.redispatchTarget ?? '');
      if (lens !== undefined) {
        await redispatchSpecialist(deps, reviewId, n, lens, defect.fixInstruction);
        return `${lens.display.toLowerCase()} lens`;
      }
    }
    return null;
  }
  if (phase === 'phase_4') {
    for (const defect of materialDefects) {
      const cluster = matchIntegrityCluster(defect.redispatchTarget);
      if (cluster !== null) {
        await redispatchIntegrity(deps, reviewId, phase, n, cluster, defect.fixInstruction);
        return `${cluster.name} integrity cluster`;
      }
    }
    return null;
  }
  if (phase === 'phase_2') {
    for (const defect of materialDefects) {
      const target = matchScoutTarget(defect.redispatchTarget);
      if (target !== null) {
        await redispatchContext(deps, reviewId, phase, n, target, defect.fixInstruction);
        return target === 'field-context-scout' ? 'field context scout' : 'citation auditor';
      }
    }
    return null;
  }
  return null;
}

export async function runPhaseCritique(
  deps: EngineDeps,
  reviewId: string,
  phase: CritiquePhase,
  inputs: PhaseCritiqueInput[],
): Promise<void> {
  try {
    const preset = normalisePreset(getReviewOptions(deps.db, reviewId).preset);
    if (preset === 'fast' && phase !== 'phase_6') {
      return;
    }
    if (critiqueRecorded(deps, reviewId, phase)) {
      return;
    }
    const logOnly = preset === 'fast';
    const n = phase.slice(-1);

    const critique = await runAgent<PhaseCriticOutput>(deps, {
      reviewId,
      phase,
      agent: 'phase-critic',
      artefactName: `p${n}-critique`,
      assembleInput: {
        artefacts: inputs,
        routingNote: `Adversarial phase critic over the ${phase} outputs. Attack them as incomplete. Read each output's selfCritique first and test whether its strongest objection is answered or merely acknowledged. Classify every gap by kind and severity. Return verdict redispatch only when at least one material defect names a redispatchTarget that produces findings for this phase; otherwise return clean with the defects logged.`,
      },
    });

    const materialDefects = critique.defects.filter((defect) => defect.severity === 'material');
    let redispatched = false;
    let targetLabel: string | null = null;

    if (
      critique.verdict === 'redispatch' &&
      !logOnly &&
      materialDefects.length > 0 &&
      priorRedispatchCount(deps, reviewId) < MAX_REDISPATCHES_PER_RUN
    ) {
      targetLabel = await executeRedispatch(deps, reviewId, phase, n, materialDefects);
      redispatched = targetLabel !== null;
    }

    insertEvent(deps.db, {
      reviewId,
      kind: 'phase_critique',
      phase,
      payload: {
        phase,
        verdict: critique.verdict,
        defectCount: critique.defects.length,
        materialCount: materialDefects.length,
        redispatched,
        headline: headlineFor(materialDefects.length, redispatched, targetLabel),
      },
    });
  } catch (error) {
    if (error instanceof DispatchPauseError) {
      throw error;
    }
    insertEvent(deps.db, {
      reviewId,
      kind: 'error',
      phase,
      payload: { message: `Phase critic skipped for ${phase} after an internal error.` },
    });
  }
}
