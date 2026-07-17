import { z } from 'zod';

export const voiceProfileSchema = z.object({
  register: z.string().min(1),
  openingMove: z.string().min(1),
  concernPattern: z.string().min(1),
  severitySignalling: z.string().min(1),
  strengthsHandling: z.string().min(1),
  closePattern: z.string().min(1),
  distinctiveTics: z.array(z.string().min(1)).min(1).max(12),
  voiceRules: z.array(z.string().min(1)).min(8).max(24),
  carriesNoThirdPartyContent: z.literal(true),
});

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

// Defence in depth for third-party confidentiality. The profile is meant to carry style only, but the
// model attests to that itself, so before it reaches the writer we deterministically strip the shapes a
// leaked manuscript detail would take: statistics, sample sizes, percentages, years, and quoted spans
// longer than the eight-word style fragment the prompt allows. Bare integers ("under 35 words", "APA 7")
// are left alone, because they carry style, not content.
const STAT_PATTERNS: RegExp[] = [
  /\bp\s*[<>=]+\s*\.?\d+(?:\.\d+)?\b/gi,
  /\bn\s*=\s*\d+\b/gi,
  /(?<![\w.])\d*\.\d+/g,
  /\b\d+\s*%/g,
  /\b(?:19|20)\d{2}\b/g,
];

// Only double quotes delimit a removable span. Single quotes and apostrophes are left alone because a
// possessive or contraction ("the author's point", "the field's future") is not a quotation, and treating
// its apostrophes as delimiters would silently mangle the very voice text this feature exists to preserve.
const DOUBLE_QUOTED_SPAN = /["“]([^"“”]+)["”]/g;

function scrubField(value: unknown): string {
  let result = String(value ?? '');
  for (const pattern of STAT_PATTERNS) {
    result = result.replace(pattern, '[redacted]');
  }
  result = result.replace(DOUBLE_QUOTED_SPAN, (whole, inner: string) =>
    inner.trim().split(/\s+/).length > 8 ? '[quotation removed]' : whole,
  );
  return result;
}

export function scrubVoiceProfile(profile: VoiceProfile): VoiceProfile {
  return {
    register: scrubField(profile.register),
    openingMove: scrubField(profile.openingMove),
    concernPattern: scrubField(profile.concernPattern),
    severitySignalling: scrubField(profile.severitySignalling),
    strengthsHandling: scrubField(profile.strengthsHandling),
    closePattern: scrubField(profile.closePattern),
    distinctiveTics: profile.distinctiveTics.map(scrubField),
    voiceRules: profile.voiceRules.map(scrubField),
    carriesNoThirdPartyContent: profile.carriesNoThirdPartyContent,
  };
}
