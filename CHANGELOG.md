# Changelog

All notable changes to MAPS (formerly MARA and Collegia) are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Until a passphrase is set, the API refuses requests addressed to any host
  other than `localhost`, `127.0.0.1` or `::1`. Without this, a website open in
  the same browser could re-point its DNS at the machine and read, change or
  delete reviews on an instance with no passphrase. Once a passphrase is set,
  MAPS answers on any address, so serving it on a LAN or behind a reverse proxy
  needs no extra setting.
- The results screen no longer loads images in reports and private notes, and
  shows their alt text as plain text instead. An image link written into model
  output made the browser fetch a remote URL when the results were opened, which
  could reveal the reviewer's IP address and the time they read the review. The
  downloadable Markdown files still contain the text exactly as written.
- When the browser reaches MAPS through a host that is not allowed, the run
  screen now shows why the server refused the connection.

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
- Follow-ups from reviewing this branch:
  - Retrying an intake failure marks the review queued and clears its failed
    intake checkpoints, so the retry can be cancelled, survives a restart, and
    re-screens the manuscript under the current rules.
  - GRIM reads a sample size written before other statistics ("n = 25, M =
    …") again, and snake_case token counts stay unredacted in logs.
  - Saved clarify answers are replayed after an ingest restart only when they
    came from the clarify form; a plain Resume still asks the questions.
  - An untouched depth chip no longer overrides the default tier from Settings.
  - A queued review can be deleted even when no worker is running.
  - The tier-3 halt message describes data tampering, matching the new tiers.
- A pause or cancel pressed on the review in flight is recorded durably when it
  is acknowledged, so a worker restart before the next phase boundary honours it
  instead of silently resuming, and paying for, the run you stopped.
- After a flood of wrong passphrases the login no longer locks everyone out for
  15 minutes. One passphrase check is let through every 45 seconds instead,
  which keeps guessing at the old ceiling while the owner can still sign in.
- Web app:
  - A wrong passphrase shows its error on the login form instead of reloading
    the page, and a lapsed session returns you to the exact page (with its query)
    after sign-in. Uploads now share that sign-in handling.
  - A lapsed session on the run page leads to sign-in instead of "Reconnecting"
    forever.
  - The run page shows each phase as it starts rather than once it has
    finished, the release-gate pill names revise-specialist, block and
    arbitration correctly and counts cycles from 1, per-lens counts use the
    server's totals rather than the capped headline list, "Complete" reads as
    success, and the time remaining is shown in minutes.
  - "Partially supported" prior assessments show their sentence (the server's
    `partially_supported` spelling was not recognised).
  - The depth chosen on the intake screen is always sent, the intake screen
    polls immediately without overlapping requests, and both preset screens
    quote the same time estimates.
  - A second file dropped mid-upload is ignored, a failed upload no longer
    leaves an orphan review, re-selecting the same file works, and Space opens
    the file picker.
  - Library cards for a review with no manuscript or a paused review can be
    deleted (and a paused one cancelled).
  - Unreleased downloads cannot be activated from the keyboard, Settings shows
    failures as failures, form fields have a visible keyboard focus ring and
    linked labels, select menus are readable, the side drawer keeps focus
    inside it, the activity log shows local time, and the browser asks for
    notification permission on your first interaction instead of on load.
- Statistics and accounting:
  - A sample size written with a thousands separator ("N = 1,234") is read as
    one number, instead of n = 1 raising a false granularity finding.
  - A correlation above 1 in absolute value is recorded as the impossible result
    knowledge/02 defines (major, editor-only) instead of being skipped.
  - The recomputed p range reads "between .03 and .04" (or "of .04").
  - gpt-5.1 is priced at its list rate rather than the Batch/Flex rate, so the
    cost ceiling no longer under-counts frontier spend by half. Discounted
    deployments can still set `MAPS_PRICING_GPT_5_1`.
  - Worker logs keep `inputTokens`, `outputTokens` and reasoning-token counts
    instead of redacting them as secrets.
- Agent and knowledge consistency:
  - The final critic is now given the manuscript's reference list it is told to
    check named works against, so it no longer blocks legitimate citations as
    fabricated; with either source missing it escalates instead of blocking.
  - Knowledge modules no longer contradict each other: strengths are three to
    five everywhere (06 said two or three), a major-class recommendation carries
    6 to 12 majors (04 said 4 to 8), the statistical lens's fallback band agrees
    with the confidence it caps, developmental points are numbered 4A.1, and
    dead references to a skill file and a non-existent module are gone.
  - The voice profiler loads the governance module like every other agent.
  - The quality-metrics contract defines the unsupported-claim penalty as a rate
    and the tone score's scale; its golden is now arithmetically reachable and
    the golden test checks that.
  - Prompts no longer tell an unattended pipeline to "halt and ask", the scout's
    plan mode names its required `mode` field, the AI-content analyst names the
    citation verdicts that actually exist, and decision hinges use the one form
    knowledge/03 mandates.
- Second review pass:
  - A failed ingest workflow (a provider error during lite-parse, say) is now a
    failed review (`ingest_failed`) instead of being read as a completed ingest
    that ran the full engine without ever asking the intake questions.
  - A tier-3 tampering halt now reads as a failure on the run page instead of
    "Review complete".
  - The intake and new-review pages stop polling and explain why once a review
    has failed before its questions were ready, and "Retry" on an intake failure
    re-runs ingest from the stored manuscript (with its real file type).
  - The role-reassignment screen again catches phrasings such as "a lenient and
    positive reviewer" and "in developer mode", without flagging participant
    instructions.
  - The post-login redirect resolves the destination and requires this origin, so
    tab- or newline-smuggled paths cannot leave the site.
  - Lens names such as "Statistics", "Methodology", "Theory" and "Ethical"
    resolve again, and "# References (APA 7)" ends the narrative word count.
  - A unit that times out on the last permitted phase attempt becomes a coverage
    gap instead of failing the whole review.
  - A pause or other control the server had nothing to act on no longer shows as
    applied.
  - Provider keys saved in Settings reach the running worker without a restart,
    and each role can be routed to OpenAI, Anthropic, Google or a local model
    with `MAPS_<ROLE>_PROVIDER` / `MAPS_<ROLE>_MODEL`. Session-only keys, which
    the worker could never read, are refused with an explanation.
  - The default tier chosen in Setup or Settings applies to new reviews without
    restarting the worker.
  - The clarify page's focus chips and notes now reach the specialists and the
    report writer as emphasis-only guidance; previously they were discarded.
  - A blank journal is no longer stored as a journal named "None".
- Worker and data fixes from a code review:
  - A parse halt (for example GROBID unreachable) now marks the review failed
    with `parse_failed` instead of leaving it stuck as "sanitizing", and a later
    run ingests normally once the parser is back rather than halting forever on
    the old checkpoint. Halt terminals carry the real error class.
  - A failed poll (a busy database, a full disk on the heartbeat) is logged and
    retried instead of crashing the worker process.
  - A running review can no longer be deleted or have a phase retried
    underneath it; a retry that arrives mid-run waits for the run to finish.
  - Finding ids are never reissued after a gate retry purges the newest ones, so
    the live stream no longer skips or mislabels the new findings.
  - When the ingest snapshot is missing on resume, the restarted ingest reuses
    the answers already given instead of asking again.
  - A blank `MAPS_CONTACT_EMAIL` is no longer sent to the citation services.
- Review engine fixes from a code review:
  - A timed-out specialist or integrity dispatch now restarts its phase through
    the supervisor, as designed, instead of silently dropping that lens as a
    coverage gap.
  - Lens names resolve to the most specific lens: "Mixed methods",
    "Qualitative methods" and "Statistical methods" no longer route to Methods,
    and "ethnographic" no longer routes to Ethics.
  - Tone-risk scoring counts only the banned phrasing column of knowledge/04, so
    the recommended replacements and required voice ("I have read the
    manuscript", "you") no longer lower the composite.
  - The narrative word count no longer stops at a concern heading such as
    "Reference list accuracy", which failed the word band on every cycle.
  - The swarm is seeded with the forty most severe findings rather than the
    first forty by id.
  - The editor's private notes and the phase 8 lessons record the recommendation
    that shipped after arbitration, not the pre-arbitration one.
  - Chi-square and z tests reported with an uppercase P are now checked.
  - Finding ids past 9999 in a prefix are accepted and matched as whole tokens.
- Ingest, sanitiser and provider fixes from a code review:
  - Participant-instruction prose such as "you are now going to see…" no longer
    trips the tier-3 role-reassignment pattern and halts the review, and "as an
    aid" / "has an aim" no longer match the AI-address pattern and get
    quarantined mid-word.
  - Word list items survive DOCX parsing, so numbered reference lists and
    bulleted body text are no longer dropped; escaped entities are decoded once.
  - Reasoning models get the effort ceiling they accept: `xhigh` for gpt-5.2+
    and codex-max, `high` for gpt-5, gpt-5.1 and the o-series, which reject
    `xhigh`.
  - A citation mismatch seen while another backend was down is no longer cached
    for 30 days.
  - A GROBID parse reports its real quality instead of always "good".
  - A DOI wrapped in brackets no longer keeps the closing bracket.
  - The cross-review similarity median averages the middle pair for even counts.
- Web app hardening from a code review:
  - The login page only redirects to a same-origin path after sign-in, so a
    crafted `?from=javascript:…` or off-site link can no longer run script or
    redirect away with a fresh session.
  - State-changing API requests that a browser marks as cross-site are refused,
    which closes CSRF against an instance with no passphrase set.
  - Adding a corrected or rotated provider key now takes effect: the newest key
    per provider wins instead of the first one ever stored. Setup's button says
    "Save key" and Settings says "Stored", since neither checks the key with the
    provider.
  - Malformed JSON bodies for settings, new reviews and answers return 422
    instead of 500, and uploads over the size cap are refused on their declared
    length before the body is buffered.
  - The event stream returns 404 for an unknown review instead of polling
    forever.
  - Pause, resume, cancel and retry show an error when the request fails rather
    than assuming it worked; Settings no longer reports "Passphrase set" or
    "Review deleted" after a failed request, and the results and settings pages
    show a load error instead of spinning indefinitely.
  - Repeated finding ids in one citation cluster no longer render duplicate
    React keys in the results drawer.
- Dependency audit is clean at the high level again: Next.js moves to 16.3.6
  (critical advisory) and overrides pin patched `fast-uri`, `sharp`,
  `ip-address`, `js-yaml`, `nanoid` and `@xmldom/xmldom`.
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
- MAPS is now licensed under the PolyForm Strict License 1.0.0 with additional
  terms. Noncommercial research, teaching and personal use are free, and any
  work MAPS contributed to must cite it. Commercial use, modification,
  redistribution and AI training remain prohibited, and journals, publishers
  and funders may not use MAPS to screen submissions without a written
  agreement. Charities, educational and public research institutions and the
  other bodies listed in the licence may now use it whatever their funding,
  and benchmarking and published
  evaluations are allowed. The AI restriction covers training, fine-tuning,
  distilling, prompting, grounding or retrieving into other AI systems, other
  than running MAPS with the model providers it supports, and building
  datasets for those uses. Not carried over from the earlier licence:
  the bans on reverse engineering, on reusing the prompts or architecture as a
  reference for another system, and on using MAPS outputs for decisions by
  institutions other than journals, publishers and funders, the bans on
  circumventing security or licensing mechanisms and on helping others breach
  the licence, the clause on the MAPS, MARA and Psynalytics names, which the
  licence no longer covers, and the
  notice that MAPS output is advisory, which remains in the README. The earlier
  confidentiality clause is dropped. The termination clause is replaced by the
  PolyForm Violations term, which gives a 32-day cure period, and the duty to
  destroy copies and certify destruction is dropped. The remedies clause, the
  severability, no-waiver and precedence clauses, and the right to seek
  injunctions outside the Netherlands are dropped. A CITATION.cff file holds
  the citation, and every package now points to the root LICENSE.
- The repository is renamed to `maps-multi-agent-academic-peer-review-system`.
- The platform is renamed **MAPS: the Multi-Agent Academic Peer-Review
  System**, everywhere: the application, prompts, documentation, licence,
  artwork, package scopes (`@maps/*`), Compose service and image, tracing
  attributes (`maps.*`), and environment variables (`MAPS_*`). Existing
  deployments keep working unchanged: every legacy `MARA_*` variable is still
  honoured when its `MAPS_*` name is unset, including in Docker Compose; an
  installation's existing `data/mara.db` keeps being used; and the key-vault
  derivation is unchanged, so stored provider keys still decrypt.
- New README cover artwork and a redrawn architecture diagram, with their HTML
  sources kept in `assets/source/` so they can be regenerated.
- Repository governance: CODEOWNERS makes the owner the required reviewer of
  every file, an importable ruleset (`.github/rulesets/protect-main.json`)
  protects `main`, and `CONTRIBUTING.md` and `docs/REPOSITORY_GOVERNANCE.md`
  document the policy and the settings that enforce it.
- Documentation rewritten for release: an enterprise README (with the broken hero
  and architecture image paths fixed and stale guidance corrected), a new
  configuration reference (`docs/CONFIGURATION.md`) covering every environment
  variable and provider routing, a new security and data-protection document
  (`docs/SECURITY.md`), and an operations runbook updated for intake failures,
  durable pause and cancel, sign-in throttling, and network exposure.
- The licence is tightened: all rights reserved with no commercial rights, and
  express prohibitions on AI training and evaluation use, benchmarking, reverse
  engineering, reuse of prompts and the knowledge base, and use of outputs for
  third-party decisions, with confidentiality, termination, remedies, and Dutch
  governing law. Every package is marked `UNLICENSED`. Superseded before
  release by the PolyForm Strict licence described earlier in this list.
- Injection handling now follows knowledge/01: instructional text aimed at the
  reviewer ("ignore previous instructions", role reassignment, forced
  acceptance, suppressed weaknesses) is Tier 2, so it is quarantined and the
  review continues with an editor-only `REV-SAN` signal that names what was found
  and where without repeating it. Only data-misrepresenting tampering (Tier 3,
  assigned by the detector) halts a run. Previously the deterministic screen
  halted on instruction text, contradicting the governance module and the
  sanitiser agent's own contract.
- Docker publishes the app on 127.0.0.1 by default (`MAPS_BIND` to widen it),
  and exemplar review letters are mounted at run time rather than copied into
  image layers.
- CI now runs gitleaks over the full history, as the README already claimed,
  and the gitleaks allowlist only suppresses the synthetic strings in their own
  test files.
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
