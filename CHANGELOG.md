# Changelog

All notable changes to Collegia are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Reviews now read the whole manuscript. The DOCX parser recovers headings from
  bold and manually styled titles, not only Word heading styles, so a paper no
  longer collapses into one undifferentiated block, and the abstract and
  reference list are extracted rather than lost. The per-agent context budget was
  raised and the excerpt now allocates its budget across every section, so a
  normal-length paper is reviewed end to end instead of only its opening pages. A
  parse that still fails to separate a paper is honestly marked degraded, which
  cautions the reviewers rather than hiding the gap.
- Perspective, theoretical, and opinion papers are no longer assessed for
  qualitative data they never claimed. The qualitative lens is now switched off
  for these no-data article types, matching the other empirical lenses.
- The recommendation is calibrated to fixability. When a manuscript's problems
  can be addressed with the existing study, data, or argument, the outcome is a
  revision rather than a rejection. Reject and reject-and-resubmit are reserved
  for work that genuinely cannot be repaired in one cycle or is out of scope, and
  a gap caused by material the reviewer could not read never drives the decision
  down.
- Issue severity is defined more precisely. A major issue is one that threatens
  the validity or interpretability of a central claim, not merely anything worth
  fixing, and a gap created by missing or unreadable material is recorded as an
  editorial coverage note rather than a major fault the authors must answer.
- The developmental letter opens with genuine thanks and what is engaging about
  the work before stating the recommendation as a considered judgment, works
  through each section as a colleague thinking alongside the authors, presents the
  rubric scores as a clear table, and closes on an encouraging, forward-looking
  note.
- The results page labels every rubric criterion with its name and a one-line
  description instead of a bare number.

## [1.3.0] - 2026-07-17

### Added
- Reported statistics are recomputed deterministically during integrity
  screening. APA-style t, F, r, chi-square, and z results are re-derived from
  their test statistic and degrees of freedom, an inconsistent p value becomes a
  ledger signal, and a result whose recomputed p crosses the .05 boundary
  becomes an editor-only signal. Reported means are also checked for
  whole-number plausibility at the stated sample size. The pass is pure
  arithmetic on the full manuscript text and costs nothing to run.
- A delete-all control in settings that removes every review, its files, and
  stale ingest snapshots behind a stronger typed confirmation, and sweeps
  directories left behind by earlier deletions. Cached citation lookups are
  kept.
- The results page now shows the full 15-criterion rubric table, a severity
  breakdown, and a clearly banded editor-only signals panel on the private
  notes tab. Editor-only findings still never enter the letter or any exported
  document.
- Reviews can be cancelled and deleted directly from the library cards.
- DOCX manuscripts now receive the full reference audit: the reference list is
  extracted from the document instead of being discarded.
- The thorough preset reads twice as much manuscript text per agent, so long
  papers lose less context exactly when depth was requested.
- A corpus staging script and dataset survey for the planned rating-calibration
  fine-tune, drawing on openly licensed peer-review corpora.

### Fixed
- The upload copy now states the true 50 MB limit.

## [1.2.0] - 2026-07-17

### Added
- The letter can be written in your own reviewing voice. At intake you may add
  one or two of your past review letters, and the report matches their register.
  The uploaded letters stay on the local machine, and only the writing style is
  used, never their content. Without them, the review uses a default reviewing
  voice mined from developmental-review craft, refined by an optional local
  exemplar corpus when present.
- Two offline measures of review quality, computed from stored reviews with no
  model cost. Template reuse measures the phrasing overlap between letters, which
  stays near zero and confirms each review is written to its own manuscript.
  Viewpoint diversity measures the overlap between specialist perspectives within
  a review, which stays low and confirms the perspectives genuinely differ.
- Review-quality scores, the critic verdict, rubric average, recommendation, and
  a composite, are recorded on the observability trace for each run.
- Optional content capture on the observability trace for local debugging,
  allowed only when the trace host resolves to this machine, so manuscript text
  never leaves it.

### Changed
- A PDF manuscript is now reviewed only on a correctly structured parse. The
  structured parser starts with the stack, and a PDF that cannot be structured
  halts for retry with a readable reason rather than being reviewed on a degraded
  reading of the file. Word documents are unaffected.
- The Word letter is rebuilt on a real document model. Numbered lists count
  through correctly, bullets are small and consistent, headings are clearly
  tiered, and the letter opens on its own cover page.
- The on-screen letter renders through one path with a comfortable reading width
  and clearer type, and the review library reads more clearly.
- The reviewing voice is enforced, not just requested. The plain-language pass is
  checked against the letter that actually ships, and the narrative length target
  is 4000 to 6000 words, matching the depth a full developmental review needs.

### Fixed
- The letter keeps its structure when the writer places an em dash at the end of
  a line, and the length check no longer miscounts a reference list that carries a
  heading other than the exact word "References".
- The unauthenticated document parser is bound to the local machine only, so it is
  never reachable from the wider network.

## [1.1.0] - 2026-07-15

### Changed
- The system is presented as Collegia, a multi-agent academic peer-review
  architecture. The README, hero image, badges, and product-facing prose carry
  the new identity. Internal code identifiers and environment variable names are
  unchanged.

### Added
- A deterministic pre-gate scrub that removes stray internal tokens and stock
  machine-writing openers from the shipped letter, and records what it removed on
  the gate record for the audit trail.
- Qualitative and broadened non-empirical paper-type handling: conceptual,
  perspective, and position papers are no longer judged against empirical-method
  criteria, and qualitative studies are assessed on qualitative rigour rather than
  statistical inference.
- A read-only review trace tool that prints the full dispatch and event timeline
  for any review from one command.
- Self-describing terminal failures: every failed run records a human-readable
  reason and the phase where it failed.
- Graceful degradation for the parallel review steps: a non-critical specialist
  lens or integrity cluster that exhausts its retries is skipped and recorded as
  an explicit coverage gap rather than ending the run, with the gap surfaced in
  the run trace, the phase checkpoint, and the editor-only notes. When every
  specialist lens or every integrity cluster fails, the run halts cleanly for
  retry instead of shipping without required coverage.
- Dependency vulnerability scanning over the lockfile alongside the secret scan,
  and an operations runbook covering monitoring, recovery, and backup.

### Fixed
- The release gate no longer treats a cosmetic surface defect as an unrecoverable
  failure. Only substantive grounding, confidentiality, and verdict-term problems
  halt a review; a complete, evidence-grounded review is never lost to a stray
  token or a stock transition word.
- A blocked or halted review now stops cleanly at the gate and does not run the
  closing metrics agents.
- Retrying a failed review records a fresh, consistent terminal state instead of
  leaving the earlier failure as the last word.
- After arbitration narrows a recommendation, the alignment rewrite that could not
  be produced cleanly now falls back to the already-validated report rather than
  discarding a complete, evidence-grounded review.

## [1.0.0] - 2026-07-15

First tagged release. The platform is feature-complete for autonomous,
evidence-grounded review of psychology and wellbeing-science manuscripts, and it
has passed a multi-reviewer code review and a goal-alignment critic.

### Added
- Nine-phase review pipeline coordinated across sixteen review agents, from
  sanitisation through to branded Word deliverables.
- Append-only evidence ledger with supersede-by-new-row semantics, merged only by
  the orchestrator inside a single transaction.
- Deterministic release gate that blocks any deliverable carrying a raw finding
  identifier, an internal machine token, a stock machine-writing tell, a banned
  verdict term, or an evidence map that does not reconcile with the ledger and the
  manuscript.
- Adversarial per-phase critic with a bounded correction budget, and a final
  release-gate critic that certifies the shipped documents.
- Field dossier retrieval with required named-literature engagement, behind an
  allowlisted, HMAC-signed egress with an eight-gram guard.
- Reviewer preliminary-assessment stress test, withheld from the review and tested
  against the evidence only after the recommendation is set.
- Integrity screening surfaced as editor-only signals with mandatory caveats,
  never as misconduct verdicts.
- Encrypted provider-key vault (AES-256-GCM), single-lease worker with gate-block
  recovery, and a live activity stream that never carries manuscript or claim text.
- Branded, deterministically generated author letter and editor summary.
- Web application for intake, live run monitoring, and results, on the Psynalytics
  design system.

### Security
- Manuscript text and author identities never enter a public query.
- Editor-only content never reaches author-facing surfaces or the read-only
  evidence endpoint.
- Full-history secret scanning with a documented allowlist for synthetic fixtures.
