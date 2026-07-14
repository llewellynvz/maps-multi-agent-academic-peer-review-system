export { maskKey, openKey, sealKey, type SealedKey } from './vault';
export {
  buildNgramIndex,
  buildProtectedCorpus,
  DEFAULT_NGRAM_SIZE,
  type NgramIndex,
  protectedCorpusText,
  sharedNgram,
} from './ngram';
export {
  canonicalQuery,
  createEgressController,
  decodeForScan,
  type EgressController,
  type EgressLogEntry,
  type EgressLogger,
  type EgressReference,
  type EgressRunContext,
  isPublishedReference,
  signQuery,
  sourceForHost,
  verifyQuery,
} from './egress';
