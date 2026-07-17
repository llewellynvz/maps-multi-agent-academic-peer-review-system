import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../paths';

export interface ReviewDir {
  reviewId: string;
  dir: string;
}

// The stored reviews an offline eval reads from. Each review's artefacts live under data/blobs/<reviewId>/.
export function listReviewDirs(): ReviewDir[] {
  const blobs = join(dataDir(), 'blobs');
  if (!existsSync(blobs)) {
    return [];
  }
  return readdirSync(blobs).map((reviewId) => ({ reviewId, dir: join(blobs, reviewId) }));
}
