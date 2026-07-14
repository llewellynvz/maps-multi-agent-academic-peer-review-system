import type { CitationClient } from '../citations';
import type { MaraDatabase } from '../db/client';
import type { DispatchRunner } from '../providers';
import type { EgressController } from '../security';

export interface EngineDeps {
  db: MaraDatabase;
  runDispatch: DispatchRunner;
  citationClient?: CitationClient;
  egress?: EgressController;
}
