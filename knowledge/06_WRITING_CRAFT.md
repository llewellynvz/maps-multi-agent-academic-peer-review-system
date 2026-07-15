# Review Writing Craft

This module owns how review prose is written: the sentence discipline, the per-concern micro-pattern, the AI-tell elimination guide (the humanize pass), and the worked before-and-after examples. It is the mechanical craft layer under the developmental stance.

Ownership boundaries: the developmental stance, the golden thread of a finding, and the banned destructive phrasing list live in knowledge/04. Rubric criteria, thresholds and the recommendation taxonomy live in knowledge/03. Artifact templates and the house-style docx look live in knowledge/05. This module never restates them. It governs every author-facing and editor-facing sentence, run after the content is right and before anything ships.

Read by: review-report-writer, review-meta-reviewer, review-final-critic, swarm-simulator, orchestrator.

## The reader you are writing for

A handling editor reads the report in about ninety seconds before deciding. A busy author reads it on a hard day. Both need to find three things without reading every word: the decision, the two or three concerns that drive it, and the concrete fix for each. If a reader has to parse a sixty-word sentence to learn what the problem is, the report has failed them, however correct the finding. Scannability is not a nicety. It is the product.

The benchmark is the reviewer who has read everything, refuses hype, and would rather show you the evidence than tell you it matters. Direct, warm, specific. Firm when the science is not met. Never robotic, never abstract, never a wall of qualified clauses.

## The per-concern micro-pattern (the unit of the report)

Every major concern is written as one scannable unit, not a paragraph of run-ons. The unit has a fixed shape:

1. **Bold problem label.** A concrete name for the concern that the reader scans for. Usually a few words ("Construct contamination.", "Design-claim mismatch."), sometimes a one-line thesis where the point needs it. Keep it to a single line, and add an inline severity flag where it earns one, for example `(fatal if unresolved)`.
2. **The problem, in one sentence.** State what is wrong, with the manuscript anchor and the exact number, table, or quote. Lead with the concrete thing, not the abstraction.
3. **Why it matters, in one sentence.** Name the validity threat (construct, internal, interpretive, statistical-conclusion, temporal order, measurement invariance, selection). One threat, named, not gestured at.
4. **The leanest credible fix.** The smallest change that makes the claim defensible, stated so the author could do it tomorrow.
5. **The ideal fix, where one exists.** The stronger version, marked as optional.
6. **The done-well target, where useful.** One line on what the fixed version looks like.

The fix is not buried in the same sentence as the problem. Problem, why, and fix are separate sentences a reader can find at a glance. This is the pattern in every one of the benchmark reports: name it, say why, give the leanest fix, then the ideal fix.

## Sentence discipline

- **One idea per sentence.** If a sentence carries the problem, the evidence, and the fix at once, split it into three.
- **Lead with the concrete.** The number, the table, the quote, the anchor goes at the front. "Table 4 reports B = 1.335 with t = 12.92, which is arithmetically impossible for an unstandardised estimate" beats "There is an inconsistency in the reporting of coefficients whereby the standard error appears to reflect a standardised quantity."
- **Length.** Average fifteen to twenty words. Hard ceiling around thirty-five. A long sentence is earned only when it specifies a mechanism, and it is followed by a short one. Vary the rhythm on purpose.
- **Kill clause-stacking.** No more than one subordinate clause per sentence. When you catch a sentence with "which is why", "so that", "as it stands", "rather than", and a trailing participle all at once, it is three sentences wearing one coat. Cut it apart.
- **Active voice, named actor.** "The manuscript reports", "the analysis assumes", "you estimate". Not "it is assumed that", "the decision was reached".
- **Present tense for the manuscript.** "Section 3 reports", not "reported".

## AI tells to eliminate (the humanize pass)

Run this scan over every draft before it ships. These patterns make prose read as machine-generated. Cut them.

**Robotic connective tissue** (the most common tell in this pipeline's drafts):

| Cut | Use instead |
|---|---|
| "which is why the honest category is" | State the category. "This is a reject and resubmit." |
| "as it stands" / "in its present form" (as filler) | Delete, or name the specific version. |
| "so that the route forward is as clear as the decision" | Delete. Show the route; do not announce it. |
| "that is a redesign rather than a revision of its surface" | "The fix is a new argument, not a reword." |
| "runs past the pillars" / "does not survive contact with" | Say the plain thing. "CPP already does this." |

**Negation and contrast** (a machine tell): "not X, it's Y", "not only... but also", "rather than... instead", "more than just". State what the thing is. "The problem is Y."

**Inflated importance and trailing participles**: "a pivotal contribution", "underscoring the need for", "highlighting the significance of". If something matters, name the consequence in concrete terms. If you cannot, delete the clause.

**Generic descriptors and marketing tone**: robust (unless statistical), comprehensive, holistic, novel (as an adjective for research), cutting-edge, seamless. Replace with the specific detail.

**Latinate over Anglo-Saxon**: utilise → use, facilitate → help, implement → do, leverage → use, methodology → method, functionality → function.

**Formulaic transitions and summaries**: "Furthermore,", "Moreover,", "Additionally,", "It is worth noting that", "In summary,", "Overall,". Let the logic carry the flow. End on substance, not an announcement.

**Throat-clearing and adverb crutches**: "It turns out that", "The reality is", "really", "simply", "fundamentally", "importantly", "crucially". Cut the adverb and state the evidence.

**False agency and narrator-from-a-distance**: "the claim collapses", "the overlap runs", "the evidence tells us". Name the actor. "CPP's abstract already states this." "You have not yet shown."

The full field guide is the humanize-text discipline. This section is its review-prose subset. The lists above are illustrative, not a closed set: the test is not "does the sentence match a listed tell" but "would a careful reader take this as machine-written". Unlisted tells ("plays a crucial role", "sheds light on", "it is important to note", the profound short declarative used as filler) fail the same test. When unsure, simplify.

## What to keep (legitimate review structure, not an AI tell)

The humanize discipline warns against bold lead-ins and heavy structure in essays. A referee report is not an essay. The following are load-bearing and stay:

- **Bold concern labels** at the head of each point. They label distinct concerns for scanning. They name the problem; they never restate the sentence that follows.
- **Decimal numbering** of developmental points (4.1, 4.2), each with a short descriptive heading.
- **The rubric table**, the metadata table, the top-findings table.
- **Inline citations and exact anchors** (page and line, table number, coefficient value). Specificity is the voice, not clutter.
- **Severity flags** inline, for example `(fatal if unresolved)`.
- **The leanest-then-ideal fix pattern.**

The humanize pass cleans the prose inside each point. It never strips the scannable skeleton.

## Anonymity in the prose

Unless a dispatch says otherwise, the review is blind. Write in the first person ("I have read the manuscript"), address the authors as "you", and sign off as `The Reviewer`. Name no reviewer, no institution, no identifying detail, in either the report or the editor summary. The confidentiality rule in knowledge/01 still binds every retrieval.

## The natural-language register (no machine tokens)

The shipped report is written by a reviewer, not printed by a system. Its prose never carries internal machine vocabulary:

- **Taxonomy tokens and underscore compounds** ("reject_and_resubmit", "minor_revision"). Write the decision as a sentence: "I recommend rejection with an invitation to resubmit."
- **Key-value lines** ("Decision: major_revision | Confidence: 0.78"). The recommendation and its confidence are prose. Confidence is carried in calibrated words, never a bare number: "I hold this recommendation with high confidence", or "the evidence sits close to the boundary with major revision, and I say so with moderate confidence."
- **Finding ids** (REV-STAT-0001) in the shipped report body. Grounding travels in the structured evidence map returned alongside the body, never inline in the prose. The internal report and the private notes keep ids: those are audit documents.
- **Pipeline vocabulary**: ledger, lens, dispatch, swarm, artefact, phase, gate, orchestrator, dossier ("the field dossier"). The reader is an author or an editor, and none of these words mean anything to them. Name the literature itself ("recent workplace mindfulness meta-analyses"), never the internal package it arrived in.

A deterministic scan enforces this at the release gate. One machine token in shipped prose is a routed-back defect, not a style note.

## The transplant test (generic content fails)

Take any evaluative sentence and ask whether it could sit unchanged in a review of a different manuscript. If it could, it says nothing about this one, and it fails. "The methods section would benefit from more detail" transplants anywhere. "The manuscript does not report how the 62 excluded participants differ from the retained 214, so attrition bias cannot be assessed" lives only here. Every strength, every concern, and every fix carries at least one detail only this manuscript could produce: the construct, the number, the table, the named literature. The final critic applies this test line by line and flags transplantable sentences.

## Primer boxes (teaching a foundational concept)

When a correction depends on a concept the manuscript's argument shows no contact with (measurement invariance, formative versus reflective constructs, common-method variance), a bare instruction to fix it is not actionable. Write a primer as a blockquote inside the concern that needs it:

> **Primer: measurement invariance.** Three to six sentences. Teach the concept plainly, cite one canonical source in APA 7, and end by connecting the concept to the specific manuscript passage that needs it.

Rules: the primer teaches the concept, never the authors. One primer per genuinely foundational gap, never more than three per report. A primer that restates the concern in longer words is filler, not teaching.

## Worked before and after

The content is identical in both. Only the writing changes.

**Robotic (rejected):**
> Multi-level integration is claimed as a differentiator, yet CPP's own abstract, body and figure require it by name, and the manuscript reproduces CPP's five themes twice without reconciling them, which is why the distinctiveness argument does not survive contact with the source it cites.

**Human (canonical):**
> **The multi-level claim does not hold (this is the decision).** You present multi-level integration as what makes the field distinct. CPP already requires it: its abstract names "interdependent dynamics between individual and systemic wellbeing", and your Table 1 reproduces CPP's five themes (p4 L06). So the feature that individuates the field is a feature the neighbour already has. This is a construct-distinctiveness problem, and it drives the recommendation. The leanest fix is to drop the multi-level leg and rebuild the argument on full-spectrum coverage, the one difference that survives the source.

Five short sentences carry what one long sentence buried. The problem is named and flagged, the evidence is quoted with an anchor, the threat is named, the fix is concrete. That is the target for every concern in the report.

## The five-step humanize pass (run before shipping)

1. **Scan for tells.** Read the draft against the AI-tell tables above. Mark every hit.
2. **Split and shorten.** Break every sentence over thirty-five words. Put the concrete thing first.
3. **Cut the connective tissue.** Remove "which is why", "as it stands", "so that", trailing participles, formulaic transitions.
4. **Restore the pattern.** Confirm each major concern is a scannable unit: bold label, problem, why, leanest fix, ideal fix.
5. **Read it as the editor.** In ninety seconds, can you find the decision, the anchor concerns, and the fixes? If not, it is not done.
