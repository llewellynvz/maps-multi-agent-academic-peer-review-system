# Changelog

All notable changes to Collegia are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Live findings are now clickable while a review runs. Selecting a row in the
  findings ticker opens a drawer with the finding's claim, its place in the
  manuscript, its severity, and the suggested next step, and the confidential
  signals counter opens a labelled editor-only list with the same detail. The
  detail comes from the existing evidence endpoint, so nothing new crosses the
  stream and the stream's masking of confidential headlines is unchanged.
- A blocked or crashed review now retries itself in the background, up to twice,
  before parking as failed with the manual Retry button still available. The
  run screen shows the retry attempt and its reason instead of halting. Retries
  are durable commands, so a worker restart can no longer lose an accepted
  retry after it has already wiped the phases it meant to re-run, duplicate
  retry clicks collapse into one, and a retry command that cannot apply is
  discarded once with an error event rather than re-polling forever.

### Fixed
- The release critic can no longer call a legitimately cited work fabricated.
  Three of four failed reviews were blocked for citing literature that sits,
  verifiably, in that review's own field dossier: the writer is instructed to
  cite only from the dossier, but the critic was never given the dossier to
  check against. The critic now receives the dossier and the report's
  structured evidence map, the dossier serialisation carries its comparator
  works, and a deterministic check routes any reference found in neither the
  dossier nor the manuscript's own reference list back to the writer before
  the critic ever judges it.
- A release-gate block now gets one chance to be fixed before it fails the
  review. A cosmetic word-count miss earned two rewrites and still shipped,
  while a substantive block was terminal on its first appearance with zero
  rewrite attempts. The writer is now told which sections the critic blocked
  and rewrites them once, and only a block that survives that rewrite fails
  the review. The one exception is a block raised after the deterministic
  rewrite budget is already spent, which stays terminal because that critic
  run is the mandatory confidentiality audit. A retried gate also reads the
  prior run's blocked sections instead of re-rolling blind, and a retry that
  regenerates earlier phases clears that memory so it cannot mislead.
- A retry aimed downstream of the blocked gate can no longer wedge a review.
  One review failed five times in a row with zero model calls because a
  phase-8 retry left the blocked phase-7 checkpoint marked complete, so every
  re-run skipped the gate and finished unreleased. A retry now re-opens the
  unreleased gate phase regardless of the requested target.
- A confidential finding can no longer be named as the evidence behind an
  author-facing rubric score. The recommendation package handed to the writer
  listed editor-only findings as the support for a criterion and as decision
  hinges, with only the identifier masked, which told the writer that hidden
  evidence existed and left it to reconstruct that evidence from the surrounding
  text. That is how a coverage limitation in the review packet reached one
  author letter as a settled reporting defect. Those identifiers are now
  withheld from the writer altogether, and a criterion left without visible
  support falls back to the author-facing ledger. Arbitration still grounds its
  decision on the complete set.
- No review can now reach its authors without the confidentiality audit having
  run. The release gate spent one shared budget on both kinds of correction, so
  two mechanical rewrites, of the kind a narrative that lands outside the word
  band triggers, used the budget up and ended the gate loop before the release
  critic ever read the letter. Arbitration then released it unaudited. The
  mechanical rewrites and the critic's revisions now draw on separate budgets,
  and when the mechanical ones are spent the critic still audits the last draft
  and can still stop the release. A cosmetic defect continues to ship through
  arbitration rather than destroying a finished review.
- The confidential editor-only section of the internal report no longer reaches
  the writer that drafts the author letter. Only the finding identifiers were
  masked before, so the similarity and stylometric signals in that section
  stayed legible to the writer in full. The section and its subsections are now
  removed from that one input, keyed on the heading wording rather than its
  number because the number varies between reports, and the release gate records
  which heading it removed so an audit can see when the strip matched nothing.
  If a novel wording ever slips past the strip, the release critic's
  confidentiality audit still stands between the draft and the authors, and a
  blocked run releases no deliverables.
  The release critic still receives the whole report, because it has to read the
  confidential material to judge whether any of it leaked.
- Reviewers now read the manuscript in its real word order. The GROBID parser
  collapsed every inline citation to the head of its paragraph and fused the
  words either side of it, so each paragraph reached the reviewers rearranged.
  It is parsed in document order now, and a scanned PDF that yields no sections
  is honestly marked degraded instead of reported as a good parse.
- A reference list written in numbered style stays a reference list. Each entry
  looked enough like a heading to end the reference section early, so the
  remaining entries were read back as body sections of the paper.
- A rate-limited citation service no longer looks like a missing citation. A
  throttled lookup was cached as "not found" for thirty days, which is what the
  reference audit reads as a possible fabrication, so a real paper could be
  called fabricated. Lookups also fall back to a title search when a DOI is
  damaged, and reference verification and topic retrieval now share one
  rate limiter instead of racing each other into the throttle.
- A specialist finding that cites an unknown earlier finding can no longer wedge
  a review. Phase 3 was the one place that merged model output into the ledger
  without checking the reference first, and the failure repeated on every retry.
- A dispatch that times out now restarts its phase as designed and is actually
  cancelled, rather than being retried as if the model had answered badly and
  left running to bill in the background. Failed dispatches also record the
  tokens they burned, so the cost ceiling can see that spend.
- Prompt-injection screening covers the whole excerpt a reviewer receives. It
  stopped at the shortest preset's budget, so on longer settings anything past
  that point reached the reviewers unscreened.
- An API key added in the settings screen is now used. Keys were sealed to disk
  or held in memory and never read back, so a review still failed on a missing
  environment variable. Environment values still take precedence.
- Deliverables are released only once the closing quality judges have passed. An
  author letter was downloadable from a review that had failed after release.
- Changing or clearing the passphrase now invalidates tokens issued under the old
  one, and a wrong-passphrase flood can no longer lock the owner out of their own
  instance. Server errors return a fixed message rather than internal paths.

### Changed
- The default frontier deployment example moved to GPT-5.6 Sol, replacing GPT-5.1,
  with a matching cost entry so spend on it is tracked. Every reasoning-class
  dispatch now defaults to the highest reasoning effort each model actually
  supports (xhigh) rather than the provider default, so the model spends as
  much effort as it can per review unless a caller explicitly asks for less.
- Every push and pull request is now checked automatically: types, lint, the full
  test suite, and a dependency audit that fails on a high-severity advisory. Lint
  runs through Biome, and the agent schemas live in one place instead of being
  re-exported from each agent directory.
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
- Refreshed all dependencies to their latest releases, including the major
  updates to TypeScript 7, Zod 4, and the Node type definitions, alongside the AI
  SDK packages, Mastra, the OpenTelemetry API, fast-xml-parser, and tsx.

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
