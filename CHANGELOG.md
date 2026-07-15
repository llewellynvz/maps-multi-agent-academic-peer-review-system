# Changelog

All notable changes to Collegia are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
