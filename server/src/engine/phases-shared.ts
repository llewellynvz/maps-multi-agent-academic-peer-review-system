import type { CitationClient } from '../citations';
import type { MaraDatabase } from '../db/client';
import type { DispatchRunner } from '../providers';

export interface EngineDeps {
  db: MaraDatabase;
  runDispatch: DispatchRunner;
  citationClient?: CitationClient;
}
