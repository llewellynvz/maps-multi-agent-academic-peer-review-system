import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { scrubVoiceProfile, type VoiceProfile } from '@mara/shared';
import { hasSchema, schemaFor } from '../../prompts';
import { createReview } from '../reviews';
import { listVoiceSamples, MAX_VOICE_SAMPLES, readVoiceSampleTexts, uploadVoiceSample } from '../voice';

let tempDir: string;
let client: MaraClient;

function textFile(name: string, body: string): { bytes: Uint8Array; filename: string; mimeType: string } {
  return { bytes: new Uint8Array(Buffer.from(body, 'utf8')), filename: name, mimeType: 'text/plain' };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-voice-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
});

afterEach(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('voice sample intake', () => {
  it('applies the 0005 migration so the voice_samples table exists', () => {
    const review = createReview(client.db, { title: 'A review' });
    expect(listVoiceSamples(client.db, review.id)).toEqual([]);
  });

  it('stores a sample, dedupes by content, and extracts its text', async () => {
    const review = createReview(client.db, { title: 'A review' });
    const first = uploadVoiceSample(client.db, review.id, textFile('past-review.txt', 'I recommend major revision.'));
    expect(first.count).toBe(1);

    const dup = uploadVoiceSample(client.db, review.id, textFile('past-review-copy.txt', 'I recommend major revision.'));
    expect(dup.voiceSampleId).toBe(first.voiceSampleId);
    expect(listVoiceSamples(client.db, review.id)).toHaveLength(1);

    const texts = await readVoiceSampleTexts(client.db, review.id);
    expect(texts).toEqual(['I recommend major revision.']);
  });

  it('caps the count at the maximum', () => {
    const review = createReview(client.db, { title: 'A review' });
    uploadVoiceSample(client.db, review.id, textFile('a.txt', 'letter one'));
    uploadVoiceSample(client.db, review.id, textFile('b.txt', 'letter two'));
    expect(() => uploadVoiceSample(client.db, review.id, textFile('c.txt', 'letter three'))).toThrow(
      new RegExp(`at most ${MAX_VOICE_SAMPLES}`),
    );
  });

  it('rejects a file type it cannot read as text', () => {
    const review = createReview(client.db, { title: 'A review' });
    expect(() =>
      uploadVoiceSample(client.db, review.id, { bytes: new Uint8Array([0, 1, 2]), filename: 'letter.exe', mimeType: 'application/octet-stream' }),
    ).toThrow(/PDF, DOCX, TXT/);
  });

  it('extracts nothing usable from an unreadable file, so derivation degrades rather than crashing', async () => {
    const review = createReview(client.db, { title: 'A review' });
    // A byte sequence stored with a .pdf extension that unpdf cannot parse: readVoiceSampleTexts must
    // surface the failure to the caller (deriveVoiceProfile catches it and falls back to the default).
    uploadVoiceSample(client.db, review.id, { bytes: new Uint8Array([37, 80, 68, 70, 0, 1, 2]), filename: 'broken.pdf', mimeType: 'application/pdf' });
    await expect(readVoiceSampleTexts(client.db, review.id)).rejects.toBeTruthy();
  });

  it('registers a schema for the voice-profiler agent so it can be dispatched', () => {
    expect(hasSchema('voice-profiler')).toBe(true);
    const parsed = schemaFor('voice-profiler').safeParse({
      register: 'Direct and analytic.',
      openingMove: 'Thanks, summary, decision by sentence three.',
      concernPattern: 'Bold label, mechanism, then the fix.',
      severitySignalling: 'Consequence, not adjective.',
      strengthsHandling: 'Two or three, caveated.',
      closePattern: 'What is worth saving, then the path.',
      distinctiveTics: ['bracketed severity flag'],
      voiceRules: ['Open the decision by sentence three', 'Head each concern with a bold label', 'Name the mechanism before the number', 'Give the leanest fix then the ideal', 'Judge the argument not the author', 'Carry one strength into the close', 'Cite literature with its function', 'End on the revised version'],
      carriesNoThirdPartyContent: true,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('scrubVoiceProfile', () => {
  function profile(overrides: Partial<VoiceProfile>): VoiceProfile {
    return {
      register: 'Direct and analytic.',
      openingMove: 'Decision by sentence three.',
      concernPattern: 'Bold label, mechanism, fix.',
      severitySignalling: 'Consequence, not adjective.',
      strengthsHandling: 'Two or three, caveated.',
      closePattern: 'What is worth saving, then the path.',
      distinctiveTics: ['bracketed severity flag'],
      voiceRules: ['Open the decision by sentence three', 'Keep sentences under 35 words', 'Cite in APA 7', 'Name the mechanism first', 'Give the leanest fix then the ideal', 'Judge the argument not the author', 'Carry one strength into the close', 'End on the revised version'],
      carriesNoThirdPartyContent: true,
      ...overrides,
    };
  }

  it('redacts a leaked statistic while leaving bare style integers intact', () => {
    const scrubbed = scrubVoiceProfile(profile({ concernPattern: 'The mediation coefficient was .34 with n = 214, p < .001.' }));
    expect(scrubbed.concernPattern).not.toContain('.34');
    expect(scrubbed.concernPattern).not.toContain('214');
    expect(scrubbed.concernPattern).toContain('[redacted]');
    expect(scrubbed.voiceRules).toContain('Keep sentences under 35 words');
    expect(scrubbed.voiceRules).toContain('Cite in APA 7');
  });

  it('removes an over-length quoted span but keeps a short style fragment', () => {
    const scrubbed = scrubVoiceProfile(
      profile({
        closePattern: 'End on "I look forward to the revised version." and open with "the burnout intervention did not reduce distress across the twelve NHS sites studied".',
      }),
    );
    expect(scrubbed.closePattern).toContain('I look forward to the revised version');
    expect(scrubbed.closePattern).toContain('[quotation removed]');
    expect(scrubbed.closePattern).not.toContain('burnout intervention');
  });

  it('removes an over-length span in curly double quotes, the shape a leak most often takes', () => {
    const scrubbed = scrubVoiceProfile(
      profile({ concernPattern: 'Reuse phrasing such as “the mediation model omits its indirect effect across the twelve study sites” here.' }),
    );
    expect(scrubbed.concernPattern).toContain('[quotation removed]');
    expect(scrubbed.concernPattern).not.toContain('mediation model omits');
  });

  it('never treats a possessive or contraction as a quote, so voice text is not mangled', () => {
    const line = "Mirror the author's many careful and considered points about the field's future direction here.";
    const scrubbed = scrubVoiceProfile(profile({ register: line }));
    expect(scrubbed.register).toBe(line);
    expect(scrubbed.register).not.toContain('[quotation removed]');
  });

  it('leaves a single-quoted short fragment alone', () => {
    const line = "Label concerns with a noun phrase such as 'A category error.' here.";
    expect(scrubVoiceProfile(profile({ concernPattern: line })).concernPattern).toBe(line);
  });

  it('redacts a four-digit year', () => {
    expect(scrubVoiceProfile(profile({ openingMove: 'As in the 2019 submission.' })).openingMove).not.toContain('2019');
  });
});
