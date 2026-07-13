# Review Lenses

This module owns the shared finding format, the lens activation map, the eleven specialist review rubrics, the six integrity check rubrics, and the first-pass independence contract. Read by: specialist-reviewer, integrity-screener, review-final-critic, orchestrator.

## The shared finding format

Every finding from every specialist and integrity dispatch carries all of these fields. A finding missing any field does not enter the ledger (ledger rules: module 01).

**Severity** (one value):

- **none**: a completed check found no defect, logged only when the run record needs it.
- **minor**: polish or reporting detail that affects no conclusion.
- **moderate**: a real weakness that lowers confidence in a claim but is repairable within the current study.
- **major**: threatens the validity of a primary claim or the contribution, must be resolved before publication.
- **fatal**: the flaw sits under the central claim and the current study cannot repair it.

**Fixability**: **easy** (wording or reporting), **moderate** (reanalysis or restructuring from existing material), **hard** (substantial new work still within reach of the current study), **not-fixable-from-current-study** (needs new data or a different design), **unclear** (cannot be judged without missing material or an author response).

**Scope**: **author-facing**, **editor-only**, or **both**. Serious integrity signals are editor-only, always (module 01).

**Anchor** (mandatory): section plus paragraph, or table/figure ID. An unanchored finding is invalid.

**Epistemic label and confidence**: Known / Inferred / Assumption plus numeric confidence and band, per module 01.

**Failure scenario** (one line): what goes wrong for the field or the reader if this stands unaddressed.

**Leanest credible fix**: the smallest revision that genuinely resolves the concern, or an explicit statement that none exists from the current study.

**The finding-level voice rule.** Severity is honest and wording is developmental. These are orthogonal dimensions, and neither may soften the other. A fatal flaw is named plainly as a problem the paper cannot currently survive AND framed as what the work needs to become publishable, never as a dismissal of the work. Full voice spec: module 04.

## The activation map

The orchestrator builds the run plan from the design classification (taxonomy: randomized trial, cohort, case-control, cross-sectional, other observational, systematic review or meta-analysis, qualitative, mixed methods, psychometric, computational or simulation, theory, commentary, case study, protocol).

**Always-on lenses**, every manuscript: novelty, argumentation, theoretical coherence, methods and design, practical significance, ethics and equity.

**Conditional lenses:**

- **Statistical** → any quantitative or mixed design.
- **Causal inference** → whenever causal language appears in the title, abstract, hypotheses, results, discussion, or implications, regardless of design.
- **Measurement and psychometrics** → survey instruments, rating scales, questionnaires, psychometric tests, or constructs treated as latent variables.
- **Qualitative** → qualitative data of any kind, including qualitative, ethnographic, phenomenological, grounded theory, narrative, and discourse designs, and the qualitative strand of mixed designs.
- **Mixed methods** → mixed data only.

**Partial activation.** Editorials, commentaries, perspectives, and protocols get argumentation, novelty, and the writing-relevant lenses only. Statistical, measurement, causal-inference, and qualitative lenses are skipped unless their domain is substantively present in the content, in which case the domain rule above wins.

**Integrity checks are not lens-gated.** All six run for every full review. A check whose object is absent (no figures, no similarity report) records a not-performable or not-applicable outcome rather than silently skipping.

## Specialist lens rubrics

Each rubric states what the lens examines, its mechanical checks, and its distinctive decision rules. Ledger fragment prefixes follow module 01 (REV-NOV-0001 and so on).

### 1. Novelty (REV-NOV)

Examines the claimed contribution against close prior work and the journal's threshold.

1. State the claimed contribution in one anchored sentence.
2. Compare it to the closest prior work in the retrieval packet.
3. Classify the novelty type: incremental, confirmatory, synthetic, methodological, theoretical, empirical, or practical.
4. Test whether the claim is overstated relative to that comparison.
5. Name the positioning moves that would sharpen contribution clarity.

Decision rules: novelty is not quality, score them separately. Replication and confirmatory work are not penalised where journal scope values them. Confidence drops when retrieval coverage is limited. **First-of-a-kind rule:** when no close prior work can be found, confidence is capped below Green (Yellow or Red), and the finding must state that the absence of matches can mean genuine novelty or retrieval failure (language bias, indexing gaps, recent publication) and recommend human domain-specialist verification before the claim is accepted.

### 2. Argumentation (REV-ARG)

Examines the logic and evidentiary flow of the whole argument.

1. Map the central argument: problem → claims → evidence → implications.
2. Hunt logical gaps, unsupported leaps, circular reasoning, and introduction-conclusion mismatch.
3. Test whether hypotheses follow from theory and conclusions follow from results.
4. **Construct-drift trace:** for any key construct, record its introduction definition, methods operationalisation, and discussion interpretation, each anchored, then name the semantic shift and its consequence for the conclusions.
5. Where structure fails, propose the concrete restructuring, not just the diagnosis.

Decision rules: writing-clarity problems and logic problems are separate findings. No single disciplinary argument style is imposed where several are acceptable. Unsupported causal leaps are decision-relevant and cross-referenced to the causal-inference lens.

### 3. Theoretical coherence (REV-THEO)

Examines theory use, construct definitions, mechanisms, and conceptual contribution.

1. Identify the core constructs and the load-bearing theoretical assumptions.
2. Assess definitions, boundary conditions, mechanisms, and treatment of competing theories.
3. Test whether hypotheses derive from theory rather than generic plausibility.
4. Screen for construct proliferation and contamination.
5. Flag theory that is decorative rather than explanatory.

Decision rules: do not demand theoretical novelty from purely empirical or methods papers unless journal scope requires it. **Theory-agnostic journal downgrade:** for empirical or methods papers at journals that do not require theoretical novelty, downgrade theory findings from major to minor when existing theory is correctly cited without misrepresentation and no claims exceed the evidence. Retain major only when the theory is incorrect, contested, or exceeded by the claims. Alternative plausible theories are preserved in the finding, not resolved by the reviewer.

### 4. Methods and design (REV-METH)

Examines whether the design can answer the research question at the claimed level of inference.

1. Assess design fit, sampling, recruitment, inclusion and exclusion criteria, procedures, controls, timing, exposure and outcome definitions, and missing-data handling.
2. Screen for selection bias, confounding, common method bias, attrition, and measurement-timing problems.
3. **Five-point design-fit tree, per primary claim:** (1) does the design permit the level of inference claimed (causal, correlational, descriptive, predictive), (2) is the comparison group adequate for the contrast, (3) is measurement timing aligned with the hypothesised process, (4) is attrition or non-response addressed in the analysis, (5) are inclusion criteria specified and justified. Any No is a design concern, severity scaled by centrality to the primary claim.
4. Audit limitation acknowledgments: accurate acknowledgment that names its own severity earns credit, a minimised or absent one is an additional concern. Acknowledgment never eliminates the concern.

Decision rules: design limitations and reporting omissions are separate findings. Limitations revision cannot repair are marked not-fixable-from-current-study. Randomised evidence is not demanded for non-causal claims.

### 5. Statistical (REV-STAT)

Examines analyses, assumptions, uncertainty, and alignment between analyses and claims.

1. Inventory models, estimands, covariates, assumptions, missing-data methods, multiplicity handling, power or precision logic, and robustness checks.
2. Test that every test matches the design and the measurement level of its variables.
3. Assess effect sizes, confidence intervals, model diagnostics, and uncertainty reporting.
4. Screen for p-value overreliance, dichotomised continuous variables, unsupported subgroup claims, uncorrected multiple comparisons, and overfitting.
5. Run the Statcheck-style screen: reported test statistics, degrees of freedom, and p-values must be mutually consistent. Any hit against the impossible-results definition (owned by the consistency rubric below) escalates there and to the ledger.
6. Benchmark effect sizes against field norms from the field-benchmark packet. Cohen's psychology conventions are not exported: medical work uses NNT, ARR, and NNH, education treats d of 0.20 or more as policy-relevant, computational work uses task-specific baselines.

Decision rules: **code-unavailable fallback:** when analysis code is absent, evaluate internal consistency of reported results, list the diagnostics that cannot be checked (residual plots, influence statistics, VIF, fit indices), cap confidence at 0.85 until they are provided, and band any finding that depends on unavailable diagnostics Red. Estimation and Bayesian approaches are not forced into null-hypothesis testing. Raw-data errors are never inferred without the data.

### 6. Measurement and psychometrics (REV-MEAS)

Examines operationalisation, scale quality, reliability, validity evidence, and invariance.

1. Inventory every focal construct and its instrument.
2. Assess content, construct, and criterion validity, reliability, dimensionality, scoring, translation or adaptation, invariance, and common-method exposure.
3. Test that the cited measurement evidence matches this population and context, not just the original validation sample.
4. Check that latent constructs are treated as latent in the analysis.
5. Trace where weak measurement directly threatens a conclusion.

Decision rules: **alpha alone is insufficient.** Cronbach's alpha of 0.70 or higher is not a validity claim. The minimum is one appropriate reliability estimate plus one form of construct validity evidence (convergent, discriminant, or criterion), and absence of that pair is at least moderate. **New-measure floor:** a measure with no prior validation record needs content-validity documentation (how items were generated, reviewed, selected), a context-appropriate reliability estimate, and preliminary construct validity evidence. Absence of all three is major regardless of other study quality. Reliability and validity are never conflated. Construct drift between theory, measure, and interpretation is flagged and cross-referenced to argumentation.

### 7. Qualitative (REV-QUAL)

Examines qualitative design, analysis transparency, credibility, and reporting, within the manuscript's stated tradition.

1. Assess fit between approach, research question, sampling, data sources, analytic method, and claims.
2. Test transparency of coding, theme development, reflexivity, audit trail, negative cases, and participant context.
3. Verify that quotations actually support the themes they are attached to.
4. Screen for generalisation beyond what the design supports.
5. **Saturation-type check:** identify which saturation the authors claim (data, thematic, theoretical, or information power) and test whether the evidence supports that specific type. "Saturation was reached" is never self-evident.

Decision rules: **cross-paradigm minimum standard:** whatever the epistemology (post-positivist, constructivist, critical, pragmatist, other), the work must show transparent data-collection procedures, a traceable analytic process ("themes emerged" is insufficient), and rigour evidence recognised within the stated tradition (member checking, negative case analysis, audit trail, thick description, inter-rater coding, or equivalents). Absence of all three is major in any tradition. No positivist or quantitative criteria are imposed on qualitative work. The stated epistemology governs where clear. Missing reflexivity is flagged when the design makes it relevant.

### 8. Mixed methods (REV-MIX)

Examines integration of quantitative and qualitative strands. Mixed data only.

1. Identify the design type and sequencing.
2. Assess integration at four levels: design, methods, results, interpretation.
3. Test whether either strand is decorative.
4. Map convergence, complementarity, expansion, and contradiction across strands.
5. Assess joint displays or the integration narrative, and propose improvements.

Decision rules: **the integration threshold:** a legitimate mixed-methods claim requires integration at minimum at the interpretation level, meaning the strands are actively compared, connected, or mutually explained in the results or discussion. Strands reported in fully separate sections with no cross-strand comparison are reclassified as "parallel strands, not integrated mixed methods", a major finding when the mixed-methods framing is central to the contribution. Equal strand weight is not required unless claimed. Well-supported contradictions between strands are preserved as findings, never smoothed away.

### 9. Causal inference (REV-CAUS)

Examines causal language, identification, confounding, and temporal order. Activated by any causal language, regardless of design.

1. Inventory every causal claim across title, abstract, hypotheses, results, discussion, and implications.
2. Test whether design plus analysis supports each claim's level of inference.
3. Assess temporal order, confounding control, selection mechanisms, mediation and moderation claims, and any causal diagram.
4. **Named-confounder rule:** for each causal claim, name 2 to 3 specific plausible unmeasured confounders from the literature, not hypothetical generics, each with its relationship to exposure and outcome, the expected direction of bias if uncontrolled, and whether prior studies found it relevant in similar designs.
5. For longitudinal data: test reverse-causality plausibility, the justification of the lag structure, and whether reciprocal relationships are addressed.

Decision rules: **cross-sectional causal claims are major** unless explicitly and appropriately qualified, with the specific passages flagged for rewording. Causal theory language is permitted alongside correlational empirics only when theory and empirical identification stay clearly distinct. Remedies are concrete: language downgrades or named sensitivity analyses, aligned with module 05.

### 10. Practical significance (REV-PRAC)

Examines whether results are practically meaningful without overstated impact.

1. Inventory practical and policy claims.
2. Assess effect magnitude against uncertainty, baseline risk, cost, feasibility, and stakeholder relevance where data permit.
3. Separate statistical significance from practical significance explicitly.
4. Flag impact claims the evidence does not carry.

Decision rules: **never invent the missing inputs.** When baseline risk, cost, feasibility, or stakeholder data are absent and not derivable from retrieved literature, list each missing data point, state what value range would change the assessment, and recommend the discussion acknowledge the gap rather than assert broad impact. Purely theoretical papers need not show practical impact unless journal scope demands it. Broad implementation claims on narrow evidence are flagged. The ask is calibrated implications, not promotional ones.

### 11. Ethics, equity, and participants (REV-ETH)

Examines participant protections, consent, harms, equity, and responsible interpretation.

1. Verify ethics approval, consent, data protection, participant risk, compensation, vulnerable-group handling, and harms reporting where relevant.
2. Assess whether demographic and equity-relevant variables are reported responsibly.
3. Screen interpretations for stigmatising, deficit-based, or unsupported group claims.
4. Recommend revisions that are both respectful and methodologically justified.

Decision rules: **the deficit-language operational test:** language is deficit-based when it frames an entire group primarily through deficits, pathologies, or deviations from an assumed norm without acknowledging structural, contextual, or historical factors that may explain the pattern. Each flagged instance quotes the passage, explains what makes it deficit-based, and supplies an alternative formulation that preserves the empirical finding. Topic alone never triggers a flag, framing does. Unethical conduct is never inferred from missing reporting alone. Serious ethics gaps escalate editor-only (signal language: module 01). Approval omissions and methodological limitations are distinct finding types.

## Integrity check rubrics

Integrity findings are signals, never verdicts, under the signal-language rules in module 01.

### 12. Reporting standards (REV-RPT)

Builds the checklist matrix against the routed guideline and scores every item **present / partially present / absent / not applicable**, with unclear items marked for author clarification. Before applying any checklist, verify the routed standard matches the design classification. A mismatch (CONSORT on a cohort study, PRISMA on a primary study) is flagged, the correct standard named, and the checklist rebuilt before scoring. Missing items that affect interpretability or reproducibility outrank formatting items. Output splits into author-facing corrections and editor-only compliance notes. Irrelevant items are never applied, noncompliance is not fatal unless it blocks evaluation, and journal-required items stay separate from best-practice recommendations. Merged checklists for multi-standard designs come from the classifier, deduplicated, each item's origin standard noted.

### 13. Similarity signals (REV-SIM)

Summarises available similarity-report thresholds, matched sources, and locations, separates benign overlap (methods boilerplate, quoted text, reference lists, preprints, protocols) from unattributed overlap in substantive text, and screens for redundant publication and salami-slicing signals where evidence exists. **Tiered self-overlap default** when journal policy is silent: under 100 consecutive words of the authors' own methods boilerplate → low risk, note without flagging. One or more complete paragraphs reproduced from the authors' prior work without citation → moderate signal, flag for editorial attention. Results-section overlap with the same authors' prior publication → serious signal, editor-only, even when the prior work is cited, because it may constitute redundant publication. Plagiarism is never labelled without human verification, and preprint overlap is not penalised unless journal policy requires it.

### 14. AI-content risk (REV-AIC)

Checks disclosure compliance against journal policy, screens for textual and metadata signals warranting editorial review, and flags fabricated-looking citations, generic unsupported claims, and inconsistency with cited source content. **Detector-limitation caveats are mandatory** whenever detector output is weighed: false-positive rates are substantially elevated for non-native English writers, detectors are not calibrated on field-specific technical jargon, and detector scores are not calibrated probabilities of authorship. Detector output is never reported as more than an editorial signal warranting attention. **Disclosure adequacy** requires three elements: the specific tool named, the purpose of use described (grammar, translation, analysis, visualisation, drafting), and an explicit statement that the authors take responsibility for integrity, accuracy, and originality. A bare "AI was used in preparing this manuscript" is inadequate under major publisher policies. Text is never asserted to be machine-generated from stylistic signals or detector output alone.

### 15. Figure integrity (REV-FIG)

Verifies figures match their captions and in-text descriptions, then screens for duplicated panels, improbably repeated patterns, inconsistent labels, impossible axes, missing scale bars, and visible compression or metadata anomalies, plus disclosure of image processing where relevant. **Forensic-referral criteria** (each an editor-only signal requesting expert image analysis): the same image region across different experimental conditions with improbably similar noise patterns, visibly inconsistent background texture or illumination within one image, an unexplained non-linear or non-uniform axis, and a missing scale bar on an imaging figure making quantitative size claims. Findings describe precisely what is observed and where. The words manipulation, fabrication, and fraud are never used, no manipulation conclusion is drawn without expert analysis, and raw images or clarification are requested where needed.

### 16. Consistency (REV-CON)

Cross-checks sample sizes across abstract, methods, results, tables, and figures, plus variable names, group labels, hypothesis numbering, model names, time points, and outcomes, and verifies that text matches tables and figures and conclusions match the reported analyses. **This rubric owns the single impossible-results definition for the whole repository:** a reported mean outside the declared scale or observation range, a correlation with absolute value above 1.0, a negative chi-square, an F-value inconsistent with its reported p-value and degrees of freedom, or a results-section N differing from the enrolled or analysed N by more than 5 percent. Every impossible result is at least major severity, editor-only until confirmed, and always enters the ledger. **Rounding tolerance:** differences of plus or minus 1 in counts or 0.01 in proportions are noted, not flagged, unless the difference changes effect direction, statistical significance, or a primary conclusion, in which case it is always flagged. Formatting inconsistencies never outrank validity-affecting ones.

### 17. Reproducibility (REV-RPX)

Verifies that data, code, materials, protocols, preregistration, and analysis scripts are available as claimed, that stated restrictions are justified and clearly described, and that the computational record supports replication. **Four-tier priority order:** (1) data and code availability → major when a custom or non-standard analysis cannot be reproduced from the methods description alone, (2) package and library versions → moderate when absent for numerically sensitive computation (statistical modelling, optimisation, machine learning), (3) random seeds → moderate when absent for any stochastic method (simulation, bootstrapping, random initialisation, subsampling), (4) hardware and environment specification → minor unless performance claims depend on it. Legitimate privacy, ethics, and proprietary restrictions are respected, reproducibility ideals are distinguished from journal requirements, and missing data or code escalates when the conclusions cannot be evaluated without them.

## First-pass independence and the challenge round

**First dispatch is blind.** A specialist's first pass receives only the manuscript map, the claim-evidence matrix, its context packets, and the ledger rules. It never sees another specialist's findings, hypotheses, or severity calls. Shared framing produces shared blind spots, so independence is mechanical, not aspirational.

**The challenge round.** After all first-pass fragments land, each specialist receives the anonymised findings of the others. It may confirm, contest, or update its own findings, but every position change must cite evidence: a manuscript anchor, a rule in this module or module 01, or a computation. "Another reviewer disagreed" is not evidence and changes nothing. Contested findings that survive the round are preserved as evidence-based dissent in the ledger, both positions anchored, for the report writer to weigh under module 03. Convergence bought without evidence is a run defect, not a success.

## What this module does not own

The review constitution, confidence bands, signal language, and ledger rules live in module 01. The 15-criterion report rubric, recommendation thresholds, and swarm mechanics live in module 03. The voice spec lives in module 04 and output templates in module 05. Phase order lives in the review skill.
