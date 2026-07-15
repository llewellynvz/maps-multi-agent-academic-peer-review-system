import { getClient, submitRunControl } from '../src/data';

const reviewId = process.argv[2];
const phase = process.argv[3] ?? 'phase_7';

if (reviewId === undefined || reviewId === '') {
  console.error('usage: tsx scripts/retry-review.ts <reviewId> [phase]');
  process.exit(1);
}

const { db } = getClient();
const result = submitRunControl(db, reviewId, 'retry_phase', { phase });
console.log(JSON.stringify(result));
