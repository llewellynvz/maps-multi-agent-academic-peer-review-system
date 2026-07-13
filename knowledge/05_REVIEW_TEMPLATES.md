# Review Templates

This module owns the canonical templates for every review-pipeline artifact. Read by: every agent (each copies the template it produces from).

Ownership boundaries: constitution and ledger entry rules live in knowledge/01. Finding format and lens rubrics live in knowledge/02. Rubric criteria, thresholds, the recommendation taxonomy, and swarm mechanics live in knowledge/03. The developmental voice spec lives in knowledge/04. This module never restates them.

Agents copy the relevant template and fill it. Field order is fixed so downstream agents parse artifacts predictably. Paths are relative to `projects/<slug>/`. Ledger IDs are lens-namespaced, format REV-<LENS>-<seq>, for example REV-STAT-0001.

The markdown templates below are the working drafts. The final `.docx` deliverables are produced in the Psynalytics house report style, specified next.

---

## House-style deliverable specification (the .docx look, non-negotiable)

The two shipped deliverables are branded A4 Word documents. They are produced at Phase 8 by the reusable generator at `.claude/skills/review-paper/assets/house-docx-generator.js` (do not hand-build docx XML). Two documents ship:

- `output/Peer-Review-Report.docx`: the referee report, addressed to the editor and authors, carrying no editor-only content (no integrity signals, no swarm figures, no confidentiality forensics). It carries the rubric-score table, which is part of the standard report.
- `output/Editor-Summary.docx`: the confidential editor-only note (recommendation and confidence, the preserved alternative reading, integrity signals in signal language, confidentiality position, scope fit, human checks).

Both are anonymous: signed "The Reviewer", no reviewer identity anywhere, unless a dispatch overrides to a signed review.

**The first page is a clean letterhead, not a full-bleed cover.** The benchmark referee reports open straight into the letterhead: a teal title block, a metadata table, then the review. No brochure-style gradient cover. The letterhead background sits on every page.

**Visual system (do not substitute):**
- Page: A4 portrait (11906 x 16838 twip). Every page sits over the full-bleed letterhead `letterhead-bg.png` (logo and contact bar at the top, footer wave and KvK line at the bottom). Content margins clear it (top ~2350, bottom ~1650, left and right 1134 twip).
- Fonts: headings **Gadugi**, body **Calibri Light**. Never Inter or Arial for the shipped docx.
- Palette: teal `008DA1`, teal-dark `006D7C`, graphite body `2B2D2E`, grey `595959`, bone `FEFCF5`, teal-tint `E8F5F7`, lime accent `A7D12B` (accent only). No other colours.
- Title block (page 1, below the letterhead header): the document type in large teal Gadugi (`PEER REVIEW REPORT`), a lime accent rule, then one grey sub-line (journal, section, date). No cover image.
- Metadata table: opens the content, a `Field | Detail` table (Manuscript ID, Title, Article type, Recommendation, and any material-scope rows). Teal header, bold teal-dark first column, teal-tint zebra striping.
- Section headers (`#`): white Gadugi on a full-width teal-dark `006D7C` banner. Sub-headers (`##`): teal-dark Gadugi, no fill. Body: Calibri Light graphite, justified. Bold inline: bold teal-dark, used for the per-concern problem labels.
- Rubric table and top-findings table: same teal-header table style as the metadata table.
- Footer: centred grey line, anonymous, `Confidential peer review · <journal> · Page N`.
- Bullets use a teal en-dash marker.

**House section structure for the Peer Review Report** (author-and-editor facing, the seven parts, matching the benchmark reports):
1. Title block and metadata table (rendered by the generator from the job config, not from body markdown).
2. `Dear Editor and Authors,` salutation and a one-paragraph lead-in: thanks, what was read, where the comments concentrate, the recommendation stated early.
3. `# 1. Brief overview`: 4 to 7 lines, what the manuscript does, constructs, design, claimed contribution, evidence types. Non-evaluative.
4. `# 2. Overall recommendation`: one line stating the taxonomy and confidence, then three bullets naming the concerns that anchor the decision.
5. `# 3. Executive summary` with `## Strengths` (3 to 5, anchored), `## Major issues` (each a bold-labelled scannable unit per knowledge/06), and `## Top five imperative changes` (numbered).
6. `# 4. Developmental feedback`: the major issues in full as numbered points (4.1, 4.2, each with a short descriptive heading), every point in the knowledge/06 micro-pattern, plus any structural upgrades and a `## Minor points` list.
7. `# 5. Rubric scores`: the criterion table (Criterion | Score | Justification) from knowledge/03, the average, and the three lowest criteria named as bottlenecks.
8. `# 6. What would change my recommendation`: a numbered minimum-revision package, each item naming the category the outcome could advance to.
9. `# 7. Closing`: the decision-hinge consolidation per knowledge/04, then `# References` (APA 7).

The recommendation taxonomy and confidence come from knowledge/03 and the meta-synthesis. The developmental stance and banned-phrasing rules (knowledge/04) and the writing craft and humanize pass (knowledge/06) bind every sentence (no em dashes, no prose semicolons, South African English, first person, anonymous). Confidence may be shown as the qualitative band alongside or in place of the numeric value, but it must not contradict the editor summary.

**Production and verification:** install `docx` under the repo if absent, run the generator with a job config, then validate every produced file with the document skill's `validate.py` and render it to PDF and image (Word COM `SaveAs(path, 17)` on Windows) to confirm the letterhead, title block, metadata table, banners, rubric table, and body read correctly. Never ship a docx you have not seen rendered.

---

## TEMPLATE 1: Peer-review report (report/full-report.md, internal)

```markdown
# Peer Review Report: <manuscript short title>

## Document header
- Publication / journal: | Manuscript ID: | Author(s):
- Handling editor: | Article type submitted:
- Editorial decision: <per knowledge/03 taxonomy>
- Resubmission class (if applicable): <preferred article type for resubmission>

## 1. Opening paragraph
<4 to 7 lines: merit of the question, review approach, decision stated upfront,
developmental invitation per knowledge/04.>

## 2. Brief overview of submission
<2 to 4 non-evaluative sentences: central aim, claimed contribution, evidence types.>

## 3. Editorial decision
- Decision: <taxonomy per knowledge/03> | Confidence: <0.00 to 1.00>
- Rationale: <3 to 4 bullets: primary reason linked to the most critical finding,
  secondary reason, fixability statement, what would change the category>

## 4. Summary of findings
### What works
<3 to 5 strengths, each: what works + manuscript anchor + honest caveat>
### Major issues
<Numbered, proportional to the decision. Each carries all five components of the
knowledge/02 finding format: issue, manuscript anchor, why it matters (named
validity threat), feasible revision path, decision hinge.>
### Imperative changes
<The non-negotiable changes, each concrete, verifiable, mapped to a major issue.>

## 5. Developmental feedback (by section)
<One subsection per manuscript section with a substantive concern: issue /
critique / supporting evidence / specific corrective formulation. Embed a short
primer box where a foundational correction is needed. Close with "Structural
upgrades required" for new elements the manuscript needs (traceability matrix,
methods statement, pre-registration protocol), each with required content and a
one-line justification.>

## 6. Editorial rubric scores
<Full criterion table and scoring anchors per knowledge/03. Every score cites
ledger IDs via the rubric mapping table (Template 4).>
- Three lowest-scoring criteria (revision bottlenecks): <each with explanation>
- Severity calibration: fatal if not fixed / repairable with substantial
  revision / minor, each list carrying ledger IDs

## 7. What I require in the revised submission
<Numbered required changes, each mapped to a Section 4 or 5 issue. A
point-by-point response document must accompany resubmission.>

## 8. Confidential editor-only note
*For the handling editor only. Never shared with authors.*
- Integrity signals: <signal language only, never verified misconduct>
- Policy concerns: <authorship, COI, disclosure compliance, journal policy>
- Disclosure requirement: <whether an AI-assisted review disclosure is required
  by journal policy, and the draft disclosure line naming the tools used, their
  purpose, and the human accountability statement>
- Recommendation confidence and caveats: <what evidence would change the decision>
- Human checks recommended: <verifications needing human expert review>
- Ledger IDs supporting recommendation: <REV-...>

## 9. Closing
<3 to 5 sentences per knowledge/04 operational rule 6: affirm the question,
identify the defensible paper inside the submission, frame revision as
rebuilding, confirm resubmission is welcome with a point-by-point response.>

## References
<APA 7 bibliography of every source cited in the review narrative.>
```

---

## TEMPLATE 2: Author feedback letter (drafted at report/author-letter.md, produced as output/author-letter.docx)

Author-facing. Written in full compliance with the developmental voice spec in knowledge/04. Target 2000 to 2500 words of narrative, excluding the rubric table and references. Omits everything in the report's Section 8 and any integrity signal.

```markdown
# Review of <manuscript short title>: feedback to the authors

<!-- Drafted under the developmental voice spec, knowledge/04. -->

## Opening paragraph
<4 to 7 lines, addressed to "you": merit of the question and the effort visible
in the submission, decision stated directly and early, developmental pathway frame.>

## Brief overview of your submission
<2 to 3 non-evaluative sentences showing the manuscript was read and understood.>

## Editorial decision
- Decision: <taxonomy per knowledge/03>
- In brief: <primary reason / secondary reason / fixability, one sentence each>

## Summary of findings
### What works
<3 to 5 anchored strengths with caveats, per knowledge/04 operational rule 1.>
### Major issues you must address
<Numbered, five components each (knowledge/02 format), validity threats named,
leanest credible fix first, decision hinge closing each issue.>
### Minor issues
<3 to 6, brief: issue / location / suggested fix. Do not affect the recommendation.>
### Imperative changes
<The non-negotiable changes, each concrete, verifiable, mapped to a major issue.>

## Developmental feedback (by section)
<Per manuscript section: issue / critique / fix, with the literature to engage
and specific corrective formulations. Structural upgrades specified exactly.>

## Editorial rubric scores
<Criterion table per knowledge/03, with the three lowest-scoring criteria
explained as revision bottlenecks.>

## What would change my recommendation
<3 to 5 specific, falsifiable conditions, each naming the category the outcome
could advance to.>

## Closing
<Per knowledge/04 operational rule 6. One sentence names the defensible paper
inside this submission. Optional: availability for clarifying questions.>

## References
<APA 7, every external claim in the letter cited.>
```

---

## TEMPLATE 3: Editor summary (drafted at report/editor-summary.md, produced as output/editor-summary.docx)

```markdown
# Editor Summary: <manuscript ID>

## Manuscript and run information
- Manuscript ID: | Journal: | Article type:
- Review context: <why this review was commissioned>
- Sanitization outcome (tier verdict from the Phase 0 injection guard): | Disclosure required: yes / no / unclear

## Recommendation
<taxonomy per knowledge/03> | Confidence: <0.00 to 1.00>

## Decision rationale
<Short paragraph linking the recommendation to the top findings, fixability,
journal scope, and swarm stability.>

## Top decision-relevant findings
| Rank | Ledger ID | Severity | Fixability | Confidence | Editor action |
|---|---|---|---|---|---|

## Integrity or policy signals
<Editor-only. Signal language only, never verified-misconduct language.>

## Swarm stability summary
- Decision stability: | Consensus entropy: | Herding risk: | Strongest dissent:
<Metrics defined in knowledge/03.>

## Severity calibration summary
- Fatal if not fixed: <ledger IDs> | Repairable with substantial revision: <IDs>
- Minor: <IDs>

## Run audit
- Run ID: | Completed: <ISO 8601>
- Agent activation map: <agents activated, confirming the Phase 0 gate passed>
- Phase 0 gate outcome: passed / conditional / blocked (<reason>)
- Run-error flags: <dispatch failures, gate-cycle cap hits, lens re-dispatches,
  arbitration events, with STATE.md pointer, or "none">

## Human checks recommended before decision
<Numbered verifications requiring human expert or editorial review.>
```

---

## TEMPLATE 4: Evidence ledger (LEDGER.md, merged only by the orchestrator)

Entry rules live in knowledge/01 and govern every row. IDs are lens-namespaced per knowledge/02.

```markdown
| Ledger ID | Lens agent | Phase | Type | Claim | Manuscript anchor | Epistemic status | Confidence | Severity | Fixability | Scope | Narrative context | Recommended action |
|---|---|---|---|---|---|---|---:|---|---|---|---|---|
| REV-STAT-0001 | | | | | | Known/Inferred/Assumption | | | | | <one plain sentence a non-specialist editor can follow> | |
```

### Rubric mapping table

Populated before the report writer produces rubric scores. One row per criterion in the knowledge/03 rubric.

```markdown
| Rubric criterion (per knowledge/03) | Criterion number | Supporting ledger IDs | Opposing/qualifying ledger IDs | Score contribution |
|---|---|---|---|---|
```

---

## TEMPLATE 5: Swarm summary (swarm/swarm-summary.md)

```markdown
# Swarm Summary: <manuscript ID>

## Configuration
- Population size: | Topology: | Rounds:
- Evidence packet version: | Raw manuscript exposed: yes/no
- Quarantined content excluded: yes/no

## Recommendation distribution
| Recommendation (per knowledge/03) | Round 0 | Final round |
|---|---:|---:|

## Stability metrics
<Consensus entropy, decision stability, herding risk, dissent vitality, evidence
convergence. Definitions and thresholds in knowledge/03.>

## Stable findings
<Ledger IDs and one-line summaries.>

## Fragile findings
<Ledger IDs and one-line summaries.>

## Strongest minority report
<Concise account of dissent that could affect the decision.>

## Report integration notes
### Phrases to strengthen
<Draft-report comments found under-evidenced or missing severity → recommended
stronger formulation>
### Phrases to soften
<Comments flagged as overconfident or unsupported → recommended qualified
formulation. Softening never drops severity below the ledger entry.>
### Minority objections to preserve in the author letter
<Evidence-based minority views → recommended placement>
### Additional checks triggered
<New check → which lens should run it → priority>
```

---

## TEMPLATE 6: QA checklist (report/qa-checklist.md)

The mechanical and completeness gate before production. Every unchecked box is a build failure.

```markdown
# QA Checklist: <manuscript ID>

## Policy and confidentiality
- [ ] Sanitization gate passed (no unresolved tier 2 or tier 3 signals).
- [ ] Disclosure line included if required.
- [ ] No confidential material left the approved toolset.
- [ ] Editor-only content fully separated from the author letter.

## Evidence grounding
- [ ] Every major concern maps to ledger IDs.
- [ ] No unsupported allegations in author-facing text.
- [ ] Integrity concerns labelled as signals, editor-only.
- [ ] Confidence and uncertainty stated per knowledge/01.

## Rubric completeness
- [ ] Every knowledge/03 criterion scored, average calculated.
- [ ] Three lowest criteria identified and explained as bottlenecks.
- [ ] Severity calibration populated: fatal / repairable / minor.
- [ ] Every criterion score references at least one ledger ID.

## Structural completeness (the seven parts)
- [ ] Salutation opens: merit acknowledged, what was read, recommendation stated early.
- [ ] Part 1 Brief overview present, non-evaluative.
- [ ] Part 2 Overall recommendation: one line plus three anchor bullets.
- [ ] Part 3 Executive summary: strengths (3 to 5, anchored), major issues, top five changes.
- [ ] Part 4 Developmental feedback: numbered points, minor points listed separately.
- [ ] Part 5 Rubric scores: table, average, three lowest as bottlenecks.
- [ ] Part 6 What would change my recommendation: numbered, each names a category.
- [ ] Part 7 Closing identifies the defensible paper and states the decision hinge.
- [ ] Every major issue carries all five knowledge/02 components including the
      named validity threat and the decision hinge.
- [ ] Imperative-changes list concrete, verifiable, proportional to the decision.
- [ ] References present, APA 7, covering every cited source.
- [ ] Banned destructive phrasing scan clean against knowledge/04.
- [ ] No duplicated comments, broken cross-references, or placeholder text.

## Writing craft (knowledge/06 humanize pass)
- [ ] Each major concern is a scannable unit: bold problem label, the problem,
      why it matters, leanest fix, ideal fix. Not a paragraph of run-ons.
- [ ] No sentence over ~35 words. Average sits at 15 to 20. Concrete leads each sentence.
- [ ] AI-tell scan clean: no "which is why", "as it stands", "so that", trailing
      participles, "not X it's Y", formulaic transitions, marketing descriptors.
- [ ] First person throughout. Anonymous: signed "The Reviewer", no reviewer identity.
- [ ] Reads in ninety seconds as the editor: decision, anchor concerns, and fixes findable at a glance.

## Word count
- [ ] Report narrative is roughly 2000 to 3000 words excluding the rubric table and
      references. Guidance, not a gate.
```

---

## TEMPLATE 7a: BRIEF.md (review project root)

```markdown
# Review Brief: <manuscript short title>

- Date started: | Deadline: <editor's due date>
- Manuscript ID: | Title: | Author count: | Article type:
- Journal and section: | Journal guidelines supplied: yes/no (<path>)
- Review-invite context (verbatim): <the editor's request or the user's instruction>
- Materials received: manuscript / data / supplements / prior reviews / none
- Activation decisions: <lenses and optional phases the Phase 0 gate activated,
  one-line reasons per knowledge/03>
- Special constraints: <blinding level, disclosure policy, word limits, none>
```

---

## TEMPLATE 7b: STATE.md (updated at every phase boundary)

```markdown
# Review Pipeline State

- Project: projects/<slug>
- Current phase: | Status: in progress | gate cycle <n> | complete | halted (<reason>)
- Last updated: <date time>

## Completed phases
| Phase | Completed | Key artifacts | Gate outcome |
|---|---|---|---|

## Activation map
<Lenses and optional phases active this run, from BRIEF.md, mid-run changes logged.>

## Gate-cycle counters
| Gate | Cycle count | Cap | Arbitration logged |
|---|---|---|---|

## Per-lens re-dispatch counts
| Lens | Dispatches | Reason for re-dispatch |
|---|---|---|

## Challenge rounds
| Round | Completed | Outcome |
|---|---|---|

## Resume instructions
<What the next session must read (paths) and do to continue. Assume no memory of this run.>

## Open issues
<Anything unresolved, with owner phase.>
```
