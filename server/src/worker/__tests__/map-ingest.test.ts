import { describe, expect, it } from 'vitest';
import { mapIngest } from '../runner';

describe('mapIngest', () => {
  it('never reads a failed or result-less workflow run as a completed ingest', () => {
    expect(mapIngest({ status: 'failed', result: null })).toBe('failed');
    expect(mapIngest({ status: 'success', result: null })).toBe('failed');
    expect(mapIngest({ status: 'suspended', result: null })).toBe('suspended');
    expect(mapIngest({ status: 'success', result: { halted: true } })).toBe('halted');
    expect(mapIngest({ status: 'success', result: { halted: false } })).toBe('ingested');
  });
});
