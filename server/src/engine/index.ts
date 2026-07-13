export { artefactExists, readArtefact, writeArtefact } from './artefacts';
export { COMPOSITE_WEIGHTS, type CompositeResult, computeComposite, loadBannedPhrases } from './composite';
export { type EngineContext, loadEngineContext, manuscriptDigest, referencesForVerification } from './context';
export {
  CORE_LENSES,
  LENSES,
  type LensDef,
  normalisePreset,
  type Preset,
  selectActiveLenses,
  selectChallengeLenses,
  swarmProfile,
} from './lenses';
export { runAgent, type RunAgentDeps, type RunAgentParams } from './dispatch-agent';
export { mergeFindingsOnce, type MergeOnceInput } from './merge';
export type { EngineDeps } from './phases-shared';
export {
  runPhase1,
  runPhase2,
  runPhase3,
  runPhase4,
  runPhase5,
  runPhase6,
  runPhase7,
  runPhase8,
  runReviewEngine,
} from './phases';
export {
  type GroundingFailureKind,
  type GroundingResult,
  extractFindingIds,
  loadBannedVerdictTerms,
  validateGrounding,
} from './grounding';
export { type ArbitrationOutcome, type ArbitrationRecord, arbitrate, narrowRecommendation } from './arbitration';
export { appendRunAudit, assemblePrivateNotes, type AssembledPrivateNotes } from './private-notes';
export { type DeliverableJob, type DeliverableMetadataRow, renderDeliverableDocx } from './docx';
export { type DeliverableKind, type DeliverableFormat, persistDeliverable } from './deliverables';
export { upsertFinalRubricScore, upsertRubricScore } from './rubric';
