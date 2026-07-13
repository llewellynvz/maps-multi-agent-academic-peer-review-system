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
export {
  type EngineDeps,
  runPhase1,
  runPhase2,
  runPhase3,
  runPhase4,
  runPhase5,
  runPhase6,
  runReviewEngine,
} from './phases';
