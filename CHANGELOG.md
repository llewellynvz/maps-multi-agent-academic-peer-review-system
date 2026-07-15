# Changelog

All notable changes to MARA are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
