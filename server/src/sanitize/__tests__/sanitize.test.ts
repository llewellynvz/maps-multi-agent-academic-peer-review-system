import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchInput, DispatchResult } from '../../providers';
import { detectInjection } from '../detector';
import { sanitizeManuscript } from '../index';
import { screenText } from '../patterns';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const clean = readFileSync(resolve(fixturesDir, 'clean.txt'), 'utf8');
const tier2 = readFileSync(resolve(fixturesDir, 'tier2-injection.txt'), 'utf8');
const tier3 = readFileSync(resolve(fixturesDir, 'tier3-injection.txt'), 'utf8');

function dispatchResult(object: unknown): DispatchResult {
  return {
    dispatchId: 'test-dispatch',
    provider: 'azure',
    model: 'gpt-cheap',
    status: 'success',
    object,
    tokens: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
    latencyMs: 1,
    langfuseTraceId: null,
    replayed: false,
  };
}

const neutralDetect = vi.fn(async () => ({ tier: 0 as const, spans: [], rationale: 'clean' }));

describe('deterministic screen', () => {
  it('finds no injection patterns in a clean manuscript', () => {
    expect(screenText(clean)).toHaveLength(0);
  });

  it('catches the hidden instruction planted in the tier-2 fixture', () => {
    const matches = screenText(tier2);
    const ids = matches.map((match) => match.patternId);
    expect(ids).toContain('ai-address');
    expect(matches.every((match) => match.tier <= 2)).toBe(true);
  });

  it('catches the aggressive injection planted in the tier-3 fixture', () => {
    const matches = screenText(tier3);
    const tier3Ids = matches.filter((match) => match.tier === 3).map((match) => match.patternId);
    expect(tier3Ids).toContain('override-previous-instructions');
    expect(tier3Ids).toContain('disregard-reviewer-guidelines');
    expect(tier3Ids).toContain('force-acceptance');
    expect(tier3Ids).toContain('suppress-weaknesses');
  });
});

describe('tier routing', () => {
  it('lets a clean manuscript pass without quarantine', async () => {
    const result = await sanitizeManuscript({
      text: clean,
      runDispatch: async () => dispatchResult({ tier: 0, spans: [], rationale: 'clean' }),
      reviewId: 'rev-clean',
      detect: neutralDetect,
    });

    expect(result.tier).toBe(0);
    expect(result.status).toBe('clean');
    expect(result.halted).toBe(false);
    expect(result.quarantineLog).toHaveLength(0);
    expect(result.sanitizedText).toBe(clean);
  });

  it('flags, quarantines, and proceeds on a tier-2 manuscript', async () => {
    const result = await sanitizeManuscript({
      text: tier2,
      runDispatch: async () => dispatchResult({ tier: 0, spans: [], rationale: 'clean' }),
      reviewId: 'rev-tier2',
      detect: neutralDetect,
    });

    expect(result.tier).toBe(2);
    expect(result.status).toBe('quarantined');
    expect(result.halted).toBe(false);
    expect(result.quarantineLog.length).toBeGreaterThan(0);
    expect(result.sanitizedText).toContain('[[QUARANTINED:REV-SAN-0001]]');
    expect(result.sanitizedText).not.toMatch(/As an AI reviewer/i);
  });

  it('halts on a tier-3 manuscript', async () => {
    const result = await sanitizeManuscript({
      text: tier3,
      runDispatch: async () => dispatchResult({ tier: 0, spans: [], rationale: 'clean' }),
      reviewId: 'rev-tier3',
      detect: neutralDetect,
    });

    expect(result.tier).toBe(3);
    expect(result.status).toBe('halted');
    expect(result.halted).toBe(true);
  });
});

describe('PIPE-25 detector dispatch', () => {
  it('dispatches the detection check at the cheap role with a schema', async () => {
    const runDispatch = vi.fn(async (input: DispatchInput) => {
      expect(input.role).toBe('cheap');
      expect(input.schema).toBeDefined();
      expect(input.phase).toBe('phase_0');
      return dispatchResult({ tier: 2, spans: [{ text: 'covert directive', reason: 'injection' }], rationale: 'x' });
    });

    const verdict = await detectInjection({ text: 'body with a covert directive inside', runDispatch, reviewId: 'rev' });

    expect(runDispatch).toHaveBeenCalledOnce();
    expect(verdict.tier).toBe(2);
    expect(verdict.spans[0]?.text).toBe('covert directive');
  });

  it('escalates a deterministically clean manuscript when the detector reports a tier', async () => {
    const text = 'A clean-looking abstract with a covert directive embedded in the prose.';
    const runDispatch = vi.fn(async () =>
      dispatchResult({ tier: 3, spans: [{ text: 'covert directive', reason: 'behaviour rewrite' }], rationale: 'llm' }),
    );

    const result = await sanitizeManuscript({ text, runDispatch, reviewId: 'rev-escalate' });

    expect(screenText(text)).toHaveLength(0);
    expect(result.tier).toBe(3);
    expect(result.status).toBe('halted');
    expect(result.quarantineLog.some((item) => item.source === 'llm' && item.matchText === 'covert directive')).toBe(true);
  });
});
