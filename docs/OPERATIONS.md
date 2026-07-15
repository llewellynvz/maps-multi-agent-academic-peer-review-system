# Operations runbook

This runbook covers day-to-day operation of the Collegia review platform: watching a
review as it runs, recovering the failure classes the engine can produce, and backing up
and restoring the durable state. Commands assume you are in the repository root on the
host that runs the container, the same place you run `docker compose`.

Throughout, `<reviewId>` is the full review identifier. Most commands also accept a
unique prefix of it.

## 1. Overview

Collegia reviews a manuscript through a nine-phase pipeline (Phases 0 to 8). A single
worker holds a lease and processes one review at a time. It leases a queued review,
ingests the manuscript, then runs the engine phases in order: sanitisation and structured
analysis, field context and citation audit, the specialist lenses with their challenge
round, integrity screening, the swarm stress-test, the internal report, the release gate,
and finally the branded deliverables.

The release gate at Phase 7 is the decision point. It scores the rubric, sets the
recommendation, has the letter written, and then tests that letter with a deterministic
validator and an independent critic. Only work that clears the gate reaches Phase 8 and
ships. Everything the engine does is written to an append-only event trail keyed to the
review, so any run can be traced and recovered from the command line.

## 2. Monitoring a run

There are three ways to watch a review, from most convenient to most detailed.

**The run page.** Open the review in the web application. The activity panel streams the
run as it happens: the phase it is on, findings as they are recorded, gate verdicts, and
any pause or error. This is the right first stop for an operator watching a live review.

**The event trail.** Every phase transition, gate verdict, arbitration, coverage gap, and
terminal outcome is appended to a per-review event stream in the database. The stream is
append-only and carries no manuscript or author text, so it is safe to read and query at
any time. It is the source of truth behind the run page.

**The read-only timeline command.** For a complete picture from the command line, print
the timeline:

```bash
pnpm -C server exec tsx scripts/trace-review.ts <reviewId-or-prefix>
```

This opens the database read-only and prints the review header (status, current phase,
error class, recommendation and confidence), the full dispatch table (each dispatch with
its phase, status, latency, and cost, and a run total), and the ordered event timeline.

### What a healthy run looks like

In the timeline you should see the phases advance in order as `phase_transition` events,
`finding_recorded` events as findings merge into the ledger, and a `phase_critique` entry
after each of Phases 1 to 6. At Phase 7 you should see one or more `gate_verdict` events
(source `grounding-validator`, then `final-critic`) resolving to `pass`, followed by a
Phase 7 `phase_transition` carrying the verdict and recommendation. The run ends with a
`run_terminal` event whose outcome is `complete`. Costs accumulate steadily across the
dispatch table with no agent repeatedly retrying.

Phase transitions, gate verdicts, and terminal outcomes all appear as their own event
kinds, so a stall or a failure is easy to locate: it is the last event before the trail
stops, or a `run_terminal` event whose outcome is not `complete`.

## 3. Recovery runbook

Each failure class below lists what the operator sees, how to confirm it, and the exact
action to recover. In every case the review keeps all of its artefacts, so recovery is a
retry, never a rebuild.

### 3.1 Release-gate halt or block (Phase 7)

**Symptom.** The review status is `failed` with `error_class = release_gate_block`.
Phase 8 did not run and no deliverables shipped. All analysis, findings, ledger, and the
draft report are retained.

**Diagnosis.** Run the timeline and read the tail:

```bash
pnpm -C server exec tsx scripts/trace-review.ts <reviewId>
```

Look for the Phase 7 `gate_verdict` events and the `arbitration` event. A genuine halt is
substantive: a confidentiality breach, a citation of finding identifiers that are not in
the ledger, or an evidence map that does not reconcile with the ledger and the manuscript.
The `run_terminal` event carries the halt reason.

The arbitration-alignment step no longer fails on a cosmetic defect. When arbitration
narrows the recommendation but the realigned letter cannot be produced cleanly, the
already-validated pre-alignment report ships at its own recommendation rather than losing
a complete review. So a `release_gate_block` that reaches you is a real, substantive halt,
not a formatting artefact.

**Recovery.** Re-run the gate. Either use the retry control on the run page for Phase 7,
or run:

```bash
pnpm -C server exec tsx scripts/retry-review.ts <reviewId> phase_7
```

Retrying the gate clears the error class, discards the Phase 7 and Phase 8 working
artefacts and the findings merged during the blocked gate cycle, and re-runs the gate from
a clean state. The upstream phases and their findings are untouched.

### 3.2 Engine error

**Symptom.** The timeline ends with a `run_terminal` event whose `outcome` is `failed`
and `errorClass` is `engine_error`. The event carries a human-readable reason that names
the phase that failed, for example that the engine hit an unrecoverable error in
`phase_3`. The review status is `failed`. The raw exception message is not in the event
(it could contain text that quotes the manuscript) and stays in the worker log alone.

**Diagnosis.** Read the reason on the `run_terminal` event to find the failing phase:

```bash
pnpm -C server exec tsx scripts/trace-review.ts <reviewId>
```

For the underlying exception, read the worker log. In the container the worker writes to
standard output and to a rotating log:

```bash
docker compose logs mara | grep -i "engine error"
```

**Recovery.** Retry the failing phase named in the reason. For a failure in Phase 3:

```bash
pnpm -C server exec tsx scripts/retry-review.ts <reviewId> phase_3
```

This resets that phase's checkpoint and re-runs the review from that phase. Completed
earlier phases are read from their cached artefacts and are not re-dispatched.

### 3.3 Coverage-gap degradation (partial)

**Symptom.** The run **completed** normally, but with reduced coverage. A non-critical
specialist lens or integrity cluster exhausted its retries and was skipped rather than
failing the whole run. The skip is recorded as a `coverageGap` error event, is carried in
the phase checkpoint snapshot, and is stated in the editor-only notes so the limitation is
visible to the handling editor.

**Diagnosis.** Find the coverage gap in the timeline. It appears as an `error` event whose
payload marks `coverageGap` with the step and the unit that was skipped:

```bash
pnpm -C server exec tsx scripts/trace-review.ts <reviewId>
```

The Phase 3 or Phase 4 `phase_transition` event lists the same gaps in its
`coverageGaps` field.

**Recovery.** None is required. The review is complete and its notes already record the
gap. Be aware that a plain single-phase retry does not regenerate the shipped letter on a
completed review: the gate and deliverable phases are already finished, so they are skipped
on retry, and retrying Phase 3 or Phase 4 refills the ledger without rewriting the report.
If a fully covered deliverable is essential, run a fresh review of the manuscript.

Note the required-coverage guard. If **every** specialist lens fails in Phase 3, or
**every** integrity cluster fails in Phase 4, the run does not degrade. It halts for retry,
because a review needs at least one completed specialist pass and integrity screening is
required. That case surfaces as an engine error on the phase (section 3.2), and you retry
the phase the same way.

### 3.4 Cost-ceiling pause

**Symptom.** The run stops cleanly with status `paused`, not `failed`. The timeline shows
a `phase_transition` event marked paused with reason `cost_ceiling`. Every dispatch
completed up to that point is retained.

**Diagnosis.** Confirm the pause reason in the timeline:

```bash
pnpm -C server exec tsx scripts/trace-review.ts <reviewId>
```

A paused entry reads as `paused: cost_ceiling`. The pause fires before a dispatch when the
spend so far plus the projected cost of the next dispatch would cross the configured
ceiling.

**Recovery.** Nothing is lost. Resume the run from the run page. The worker leases the
review again on its next poll and replays every already-completed dispatch from its cached
artefact, so no completed work is paid for twice, then continues from the point it paused.

If the ceiling was the reason, raise or clear it first (the per-run cost ceiling, or the
global ceiling in the settings screen) before resuming, otherwise the run pauses again at
the same dispatch.

## 4. Backup and restore

All durable state lives in one directory, `./data`, which the container mounts as
`/app/data`. It holds:

- `data/mara.db` (the primary review database, with its `mara.db-wal` and `mara.db-shm`
  write-ahead-log sidecars).
- `data/mastra.db` and `data/citation-cache.db` (the ingest and citation-cache databases,
  each with their own sidecars).
- `data/blobs/<reviewId>/` (the per-review blob and artefact store: the manuscript blob
  and every engine artefact under `engine/`).

The database file helpers resolve these paths from `server/src/paths.ts`
(`maraDbPath()` returns `data/mara.db`, `blobDir(reviewId)` returns
`data/blobs/<reviewId>`), and the container maps them from the host through the `./data`
volume declared in `docker-compose.yml`.

### Backup

Take the backup with the stack stopped so the databases are checkpointed and the copy is
clean. Copy the whole `data` directory, which captures both the database files and the
blob and artefact store together.

```bash
docker compose stop
cp -a ./data "./backups/data-$(date +%Y%m%d-%H%M%S)"
docker compose start
```

Copying the whole directory keeps `mara.db` and its write-ahead-log sidecars together,
which matters because the sidecar can hold recently committed rows. The evidence ledger is
append-only: corrections supersede earlier findings by adding new rows rather than
rewriting them, so a snapshot of the database is internally consistent and never captures
a half-edited finding. That makes each backup a clean point-in-time image.

### Restore

Restore replaces the whole `data` directory from a backup with the stack down.

```bash
docker compose down
mv ./data "./data-old-$(date +%Y%m%d-%H%M%S)"
cp -a ./backups/data-YYYYMMDD-HHMMSS ./data
docker compose up -d
```

On start, the container re-runs the database migrations against the restored database and
brings up the web application and the worker. Confirm readiness with `docker compose ps`,
where the `mara` service reports healthy. Once the restore is verified, remove the
`data-old-*` directory you set aside.

## 5. Retention of artefacts

A review that failed, halted, or was blocked keeps all of its artefacts. Nothing is
deleted on failure. The analysis outputs, the merged findings, the append-only ledger, and
any report that was produced before the stop all remain in the review's blob store under
`data/blobs/<reviewId>/` and in the database. This is what makes every recovery in
section 3 a retry: the engine reads the completed work back from cache and resumes rather
than starting over. It also means a failed review can be inspected in full before you
decide whether to retry it.
