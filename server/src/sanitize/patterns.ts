export type QuarantineTier = 1 | 2 | 3;

export interface InjectionPattern {
  id: string;
  tier: QuarantineTier;
  regex: RegExp;
  description: string;
}

export const injectionPatterns: InjectionPattern[] = [
  {
    id: 'override-previous-instructions',
    tier: 3,
    regex: /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier|the\s+system)\s+(instructions|prompts?|messages?|context)/i,
    description: 'Attempt to override prior instructions',
  },
  {
    id: 'disregard-reviewer-guidelines',
    tier: 3,
    regex: /disregard\s+(your|the|all|any)\s+(reviewer|review|system|previous|prior|editorial)\s+(guidelines?|instructions?|rules?|criteria)/i,
    description: 'Attempt to discard reviewer guidelines',
  },
  {
    id: 'role-reassignment',
    tier: 3,
    regex: /you\s+are\s+now\s+(an?\s+|the\s+)?[a-z]/i,
    description: 'Attempt to reassign the reviewer role',
  },
  {
    id: 'force-acceptance',
    tier: 3,
    regex: /recommend\s+(this|the)\s+(paper|manuscript|submission|article)\s+for\s+(immediate\s+)?accept/i,
    description: 'Attempt to force an acceptance recommendation',
  },
  {
    id: 'suppress-weaknesses',
    tier: 3,
    regex: /do\s+not\s+(report|mention|list|include)\s+(any\s+)?(weakness|weaknesses|flaws?|problems?|issues?|limitations?)/i,
    description: 'Attempt to suppress reported weaknesses',
  },
  {
    id: 'new-instructions-header',
    tier: 3,
    regex: /\bnew\s+instructions?\s*:/i,
    description: 'Injected new-instructions header',
  },
  {
    id: 'override-system',
    tier: 3,
    regex: /override\s+(your|the)\s+(instructions|guidelines|rules|system\s+prompt)/i,
    description: 'Attempt to override the system prompt',
  },
  {
    id: 'ai-address',
    tier: 2,
    regex: /as\s+an?\s+ai(\s+(language\s+model|reviewer|assistant|system))?/i,
    description: 'Text addressed to an AI reviewer',
  },
  {
    id: 'note-to-reviewer',
    tier: 2,
    regex: /note\s+to\s+(the\s+)?(reviewer|editor|ai|assistant)\s*:/i,
    description: 'Hidden note directed at the reviewer',
  },
  {
    id: 'chat-role-marker',
    tier: 2,
    regex: /(^|\n)\s*(system|assistant|user)\s*:/i,
    description: 'Injected chat-role marker',
  },
  {
    id: 'evaluation-steer',
    tier: 2,
    regex: /please\s+(rate|score|mark|grade|consider)\s+(this|it|the\s+\w+)\s+(as\s+)?(highly|positively|excellent|strong|significant|original)/i,
    description: 'Attempt to steer the evaluation',
  },
  {
    id: 'zero-width',
    tier: 1,
    regex: new RegExp('[\\u200B\\u200C\\u200D\\u2060\\uFEFF]'),
    description: 'Zero-width or invisible character',
  },
  {
    id: 'control-character',
    tier: 1,
    regex: new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]'),
    description: 'Non-printing control character',
  },
];

export interface PatternMatch {
  patternId: string;
  tier: QuarantineTier;
  start: number;
  end: number;
  matchText: string;
  description: string;
}

export function screenText(text: string): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const pattern of injectionPatterns) {
    const flags = pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`;
    const regex = new RegExp(pattern.regex.source, flags);
    let found = regex.exec(text);
    while (found !== null) {
      const matchText = found[0];
      matches.push({
        patternId: pattern.id,
        tier: pattern.tier,
        start: found.index,
        end: found.index + matchText.length,
        matchText,
        description: pattern.description,
      });
      if (matchText.length === 0) {
        regex.lastIndex += 1;
      }
      found = regex.exec(text);
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}
