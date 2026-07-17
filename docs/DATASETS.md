# Peer review datasets for rating calibration

Research summary for the planned fine-tuning phase: which public corpora carry peer reviews with ratings or decisions, what each may be used for, and the recommended path. Staged locally by `server/scripts/fetch-corpus.ts` into the gitignored `data/corpus/`.

## The candidates

| Corpus | Size | Ratings carried | Licence | Domain fit for this platform |
|---|---|---|---|---|
| Reviewer2 / PGE (HuggingFace `GitBag/Reviewer2_PGE_cleaned`) | 27k papers, 99k reviews | Per-review scores and aspect prompts, six venues | Apache-2.0 | Low (ML and NLP venues) but the largest clean instruction-shaped set |
| F1000Research (official API, JATS XML) | Tens of thousands of articles, reviews embedded per version | Reviewer decision per report (approved, approved with reservations, not approved) | CC-BY 4.0 | Highest: multidisciplinary including psychology, health, and behavioural science, with revision rounds |
| PeerRead | 14.7k papers | Accept/reject plus aspect scores (clarity, originality, soundness) | Research use | Low (ACL, ICLR, NeurIPS) |
| ASAP-Review | 8.9k papers | Aspect-annotated review sentences | Research use | Low (ICLR, NeurIPS) |
| NLPeer | 5k+ papers, multiple venues | Varies by venue, includes F1000 subset | Mixed per venue | Medium (includes non-ML venues) |
| MOPRD | Multidisciplinary | Editorial decisions, review reports, rebuttals | Research use | Medium |
| FMMD (arXiv 2602.14285) | F1000-based, multimodal | Version-aligned reports and decisions | CC-BY (derived) | High, adds figure alignment |

## What the staging script fetches

Knobs: `CORPUS_F1000_QUERY` overrides the search (default `psychology OR wellbeing OR "mental health"`) and `CORPUS_F1000_PAGES` sets how many 100-result pages to walk (default 3).

1. **Reviewer2 PGE cleaned splits** (train, validation, test parquet). The instruction-shaped pairs (paper plus aspect prompt to review with score) are the right shape for supervised fine-tuning of a rating head.
2. **F1000Research psychology and wellbeing subset.** One JATS XML per article version. Reviewer reports are `sub-article` nodes with `article-type="reviewer-report"` carrying the decision, author responses carry `article-type="response"`. Verified live: research articles in the subset embed 3 to 5 reports each.

## Recommended fine-tune path

The goal is calibration of the 15-criterion rubric and the recommendation, not letter generation (the pipeline already writes letters well and the voice is owned by knowledge/06 plus the per-review voice profile).

1. Build a rating-calibration set: F1000 psychology and health reports paired with their decisions as the domain-matched core, Reviewer2 scores as the large-scale scaffold, weighted towards the domain match.
2. Fine-tune a small open model (the Llama-OpenReviewer-8B recipe demonstrates the approach on 79k reviews) as a scorer that maps manuscript sections plus a criterion to a score with rationale.
3. Serve it through the existing `local` Ollama role (`server/src/providers/registry.ts`), which the manifest system can already route to per agent, so the platform needs no plumbing changes.
4. Evaluate against the stored letters as the benchmark: score-text consistency (T5d machinery) and calibration mode against the recommendation distribution before the model influences any live review.

Known caution from the literature: AI reviewer scores are inflatable by stylistic rewriting (the laundering result, +0.45 without substantive change), so the laundering eval must gate any fine-tuned scorer before it ships.
