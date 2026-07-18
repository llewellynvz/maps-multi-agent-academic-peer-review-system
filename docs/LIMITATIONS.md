# Known limitations

This page records what the platform deliberately does not do yet, why each limit stands, and the proven external approach that would close it if it ever becomes worth building. A limit listed here is a decision, not an oversight.

## Manuscript understanding

**Figures and images are not inspected.** The pipeline works from extracted text only. Figure and table captions are analysed, but plot axes, image manipulation, and visual claims are invisible. Closing this means extracting figure images at ingest and adding a multimodal reviewer dispatch. The reference design is Agent Reviewers (ICML 2025), which added multimodal reviewers with shared memory specifically for visual elements.

**Cited papers are checked by abstract only.** Reference verification confirms existence and claim-abstract alignment through Crossref, OpenAlex, and Semantic Scholar. It never reads a cited paper's full text, so a subtle misrepresentation of a source's method or effect size can pass. Full-text retrieval would need a licensed corpus or open-access resolution and a per-reference reading dispatch.

**Supplementary materials, code, and data repositories are not examined.** A single PDF or DOCX per review. Statistical scripts, OSF links, and datasets referenced by the manuscript are not fetched or audited.

**Only very long manuscripts exceed the LLM context budget.** The manuscript excerpt is budgeted per preset (fast, balanced, and thorough carry progressively larger budgets) and allocated across every section, so a normal-length paper is read end to end and no section is invisible. The deterministic statistics verifier reads the full text unconditionally. The Phase 7 synthesis agents, which already hold the full findings ledger and the draft report, receive a bounded excerpt to keep the largest prompt inside the model context window. Only a paper well beyond typical length has its later sections condensed, and a dispatch that would still exceed the model window fails fast rather than retrying. MARG (allenai/marg-reviewer) demonstrates chunk-distribution across communicating agents if full-text reasoning coverage of very long papers becomes a requirement.

## Review lifecycle

**No revision-round support.** One manuscript per review. A resubmission arrives as a brand-new review with no memory of the previous round, no diff against the earlier version, and no check of the response-to-reviewers letter. Closing this needs manuscript versioning in the schema and a comparison phase.

**One review at a time.** The worker holds a single lease and processes the queue strictly serially. Concurrent reviews would need per-review leases and provider rate-limit budgeting.

**Single operator.** One instance passphrase, no user accounts, no per-user ownership. Anyone with the passphrase sees and controls everything.

## Telemetry

**Dispatch retry counts read zero.** The AI SDK's internal retry loop does not surface attempt counts, so the retryRate metric is structurally zero. The honest fix is replacing the SDK retry loop with an instrumented one, judged not worth the risk so far.

## Integrity signals

**Similarity and AI-content checks are heuristic signals, not detector verdicts.** No commercial plagiarism index or AI detector is integrated. Findings in this area are editorial signals routed to the editor-only channel by design, and the deterministic statistics verifier (statcheck and GRIM style) reports reporting inconsistencies, never misconduct conclusions.
