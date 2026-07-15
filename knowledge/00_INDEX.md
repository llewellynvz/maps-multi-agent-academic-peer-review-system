# Knowledge Base Index

This folder is the single source of truth for how manuscripts are reviewed. Each module owns its topic. No rule appears in two modules. If two statements ever conflict, the owning module below wins and the other statement is a bug to fix.

## Ownership map

| Module | Owns | Read by |
|---|---|---|
| 01_REVIEW_GOVERNANCE.md | Review constitution, confidentiality and retrieval rules, injection and tampering tiers, signals-not-verdicts terminology, epistemic labels and confidence bands, evidence ledger rules and fragment-merge protocol | every agent, orchestrator |
| 02_REVIEW_LENSES.md | Shared finding format, lens activation logic, the 11 specialist lens rubrics, the 6 integrity check rubrics, THE impossible-results definition, first-pass independence and challenge-round contract | specialist-reviewer, integrity-screener, manuscript-analyst, review-final-critic, orchestrator |
| 03_REVIEW_DECISION.md | The 15-criterion editorial rubric, recommendation taxonomy and thresholds, decision-hinge device, cross-agent challenge protocol, swarm evaluation spec, revise-specialist routing | review-meta-reviewer, swarm-simulator, review-report-writer, review-final-critic, orchestrator |
| 04_DEVELOPMENTAL_VOICE.md | The developmental stance, THE banned destructive phrasing list, the golden thread of a finding, review-prose language mechanics | review-report-writer, review-final-critic, swarm-simulator, specialist-reviewer, integrity-screener, orchestrator |
| 05_REVIEW_TEMPLATES.md | Every artifact template: peer-review report, editor summary, evidence ledger and rubric-mapping table, swarm summary, QA checklist, BRIEF, STATE, and the house-style docx look | every agent |
| 06_WRITING_CRAFT.md | How review prose is written: sentence discipline, the per-concern micro-pattern, the AI-tell elimination (humanize) pass, anonymity in prose, worked before-and-after | review-report-writer, review-meta-reviewer, review-final-critic, swarm-simulator, orchestrator |
| exemplars/ | Llewellyn's past review letters used as voice benchmarks | review-report-writer (agents fall back to 04 when empty) |

## Canonical values (resolve any drift against this table)

- Recommendation taxonomy and thresholds: live only in 03_REVIEW_DECISION.md.
- Confidence bands (Green 0.98 to 1.00, Yellow 0.70 to 0.97, Red below 0.70): live only in 01_REVIEW_GOVERNANCE.md.
- Impossible-results definition: lives only in 02_REVIEW_LENSES.md.
- Banned destructive phrasing list: lives only in 04_DEVELOPMENTAL_VOICE.md.
- Review writing craft (sentence discipline, per-concern micro-pattern, AI-tell/humanize pass, natural-language register and machine-token ban, transplant test, primer boxes, anonymity in prose): lives only in 06_WRITING_CRAFT.md.
- Sentence cadence: average 15 to 20 words, hard ceiling around 35, deliberate variation with short sentences for control (owning detail in 06).
- Deliverables per review: `output/author-letter.docx` (the peer-review report, author-and-editor facing, titled with the user's review name) and `output/reviewer-private-notes.docx` (editor-only, carrying the editorial synthesis and run audit), both in the Psynalytics house report style, each with a markdown twin; full report, meta-synthesis and evidence ledger (.md, stay in the project folder as the audit trail). The report is anonymous (signed "The Reviewer", no reviewer identity in either document) and follows the seven-part structure: Brief overview, Overall recommendation (natural reviewer prose, never tokens), Executive summary, Developmental feedback (4A majors in full, 4B by-section review with the Discussion always interpreted), Rubric scores, What would change my recommendation, Closing. The shipped report body carries no finding ids; grounding travels in the structured evidence map (owning detail in 05). The house-style docx look lives only in 05_REVIEW_TEMPLATES.md and is produced by the platform's deterministic generator, never by an agent. Every author-facing and editor-facing sentence passes the 06 humanize pass and natural-language register before shipping. The narrative target for the shipped report body is 2500 to 4000 words, enforced by the final critic.
- Ledger IDs: namespaced REV-<LENS>-<sequence>, written to fragment files, merged only by the orchestrator.
- Gates and pipeline order: live only in .claude/skills/review-paper/SKILL.md.
- Golden thread of every finding: anchor → validity threat → leanest credible fix → decision hinge.

## Reading discipline for agents

Do not load every module. Read the modules named in your agent definition plus 01 (always) and the templates you produce from 05. Any agent that writes author-facing or editor-facing prose also reads 04 (stance) and 06 (craft). Loading everything wastes context and dilutes attention.
