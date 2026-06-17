# Best-of-N / Bakeoff

Status: P0 accepted. The current working tree contains an uncommitted first
implementation of the core/API/CLI/dashboard slices. This document is now the
product contract plus implementation-status reference; it is no longer only a
pre-implementation P0 sketch.

Best-of-N lets an operator run the same work through multiple builder Agents,
compare the resulting implementations, and approve one winner through normal
Ductum approval and merge rules.

This is dashboard-first and CLI-capable. A UI-less MVP is not accepted.

## Locked Decisions

- The normal operator model remains Factory -> Project -> Repository/Component
  -> Spec -> Task -> Attempt.
- Do not add Operation or WorkOrder tables.
- Do not reintroduce YAML as authority.
- Do not auto-merge or bypass normal approval.
- Do not use prose-only winner selection.
- Builder and reviewer must always use different models.
- The judge/reviewer is cost-blind. Ductum applies cost ranking after quality
  and eligibility are decided.
- Cost ranks only eligible candidates. Cheap broken work must never win.
- The dashboard compare screen is part of the MVP.
- CLI can create and inspect bakeoffs, but CLI alone is not the product.

## Product Decisions And Remaining Questions

These are the accepted product decisions plus the remaining questions that
should not block the first dogfood run.

### 1. Builder Selection

Recommendation:

- MVP uses a manual dashboard builder picker.
- The picker shows Agent name, model, provider, harness, cost tier, recent
  health, and whether the Agent is assigned to the Project as a builder.
- Default builder set is a saved Factory preference initialized, when
  configured, to GPT 5.5, GLM 5.2, and Claude Opus 4.8.
- Default max builders per bakeoff: 5.
- Recommended hard cap for MVP: 5.
- The picker should make it easy to add cheap/fast builders alongside the named
  default set, because cheap-model behavior is part of the value of Best-of-N.
- Cheap-first set is a preset for exploratory work, not the default for
  important implementation work.
- Multiple builders may use the same provider or harness.
- Multiple builders using the same model are allowed only when the compared
  configurations are meaningfully different, such as different effort levels,
  agent instructions, harnesses, or budget modes.
- Duplicate candidates with the same model and same configuration are not useful
  and should be rejected by validation.

Tradeoffs:

- Five builders increases discovery, makes cheap models visible, and still keeps
  review load bounded.
- Same-model candidates are useful for prompt/persona bakeoffs, but they weaken
  model-diversity comparisons unless effort/configuration differs.
- Cheap-first is useful for rough tasks, but it can bias operators toward low
  quality if shown as the default.

Unresolved questions for Arnold:

- Which cheap/fast builders should the dashboard suggest when the operator wants
  to fill all five slots?
- Should same-model/different-effort comparisons be shown by default or behind
  an advanced toggle?

### 2. Reviewer / Judge Selection

Recommendation:

- MVP uses one Best-of-N judge task backed by one reviewer Agent/model.
- Reviewer model must always be different from every builder model.
- Default reviewer selection prefers Claude Opus 4.8 when no candidate uses a
  Claude model and Opus 4.8 is not also a builder.
- If any candidate builder uses a Claude model, the default reviewer should be
  GPT 5.5 when GPT 5.5 is not also a builder.
- If the preferred reviewer model is already in the builder set, the dashboard
  must force a different configured reviewer or require the operator to swap the
  builder/reviewer selection. The different-model rule wins over defaults.
- Operator can define reviewer Agents in Factory Settings and manually pick the
  reviewer in the dashboard.
- Review should be blind to candidate identity by default: Candidate A/B/C,
  no builder Agent names in the reviewer prompt.
- Review should also be blind to model names, providers, token usage, and cost.
  The judge evaluates quality, correctness, maintainability, safety, and tests.
- Operator compare view should show identities after review, because the human
  needs model/cost accountability.
- Ductum computes cost-efficiency after the judge has produced the quality
  verdict.
- Multiple reviewers are later scope, useful for high-risk work or tie breaks.

Tradeoffs:

- One reviewer is simpler, cheaper, and easier to audit.
- Multiple reviewers reduce single-reviewer bias but add latency, cost, and a
  second aggregation problem.
- Blind review reduces model/agent reputation bias, but full blindness is hard
  if diffs reveal style or branch names.
- Cost-blind judging keeps the review focused on best work. Cost efficiency is
  still visible to the operator and used by Ductum after eligibility is known.

Unresolved questions for Arnold:

- Should security-sensitive specs force two reviewers?
- Should an operator be allowed to pick a reviewer that is not assigned to the
  Project if they have factory-level reviewer rights?

### 3. Eligibility Gates

A candidate cannot win unless all required gates pass:

- Implementation completed.
- Required verify commands passed.
- Review passed, or WARN was explicitly accepted by policy/operator.
- A candidate that does not pass its own review cannot win.
- No safety, process, authorization, or workflow block remains.
- Artifacts are available for inspection: branch/worktree, diff, run evidence,
  verification output, and runtime snapshot where available.

Recommendation:

- Eligibility is binary and shown before ranking.
- Ineligible candidates remain visible in the compare view with the exact
  blocking reason.
- WARN acceptance should require an explicit policy setting or operator action.
- Failed review, failed verification, safety/process block, and missing
  inspection artifacts are hard blocks in MVP.

Tradeoffs:

- Strict gates prevent cheap broken work from winning.
- Strict gates may reject creative partial solutions that are useful as
  reference material; those can still be inspected or rerun.

Unresolved questions for Arnold:

- Should WARN be eligible by default, or require operator acceptance every time?

### 4. Ranking And Scoring

Best-of-N needs both raw metrics and computed scores. Operators must see why a
candidate won.

Raw metrics:

- tokens in
- tokens out
- total tokens
- cost USD
- elapsed time
- number of attempts
- review passes
- fix rounds
- verification failures
- final verify status
- review verdict
- reviewer confidence
- operator override reason, when present

Computed scores:

- implementation score
- review score
- test score
- cost-efficiency score
- overall score

Recommendation:

- Score each category on 0-10.
- MVP uses one consistent scoring rubric across bakeoffs. Operators should not
  edit weights per bakeoff in MVP.
- MVP policy: `quality-gated-cost-aware`.
- Fixed MVP weights after eligibility:
  - implementation: 40 percent
  - review: 25 percent
  - tests: 20 percent
  - cost efficiency: 15 percent
- Cost-efficiency score should compare eligible candidates only.
- The judge provides quality scores and rationale without seeing cost.
- Ductum computes cost-efficiency and overall score after the judge verdict.
- Elapsed time is captured and shown, but it is not part of the MVP overall
  score.
- Dashboard should show both score and raw metrics side by side.

Tradeoffs:

- A transparent weighted score is easy to explain.
- Scores can create false precision, so raw metrics and reviewer notes must sit
  next to the computed score.
- Cost score is useful only after quality and process gates pass.

Unresolved questions for Arnold:

- Should elapsed time become a later tie-breaker, or stay informational only?

### 5. Verdict Contract

The structured verdict belongs to the Best-of-N judge task, not the normal
single-builder review flow. The judge emits a cost-blind quality verdict.
Ductum attaches measured cost/token/runtime metrics and computes scores in the
compare/status response after the judge output.

Implemented judge verdict minimum:

```json
{
  "kind": "best-of-n-verdict",
  "winnerTaskId": "task-id",
  "scores": [
    {
      "taskId": "task-id",
      "passed": true,
      "confidence": 0.86,
      "notes": "Candidate has the cleanest implementation and complete tests."
    }
  ],
  "policy": "quality-gated-cost-aware",
  "reason": "Candidate task-id is the best eligible implementation."
}
```

Recommendation:

- The judge emits blind quality findings and winner reasoning.
- Ductum attaches measured cost/token/runtime metrics and computes
  cost-efficiency after the judge output, so the judge stays cost-blind.
- Router/lifecycle must consume structured verdict data, not prose.
- Prose review can exist, but it is explanatory only.
- The judge verdict must not include cost or override fields.
- Operator override remains later scope. It must be a separate explicit
  decision with reason, linked to the verdict and projected into compare/status
  output.

Unresolved questions for Arnold:

- What exact confidence scale should the judge use: 0-1, 0-10, or LOW/MED/HIGH?

### 6. UI Flow

The UI flow is the product center. Operators need to see progress and visualize
results clearly; otherwise Best-of-N is just N background jobs and a guess.

Dashboard-first MVP flow:

1. Create Best-of-N from Project/Spec area.
2. Enter or attach prompt.
3. Pick target Repository/Component scope.
4. Pick builder Agents.
5. Pick reviewer/judge Agent or accept default.
6. Pick policy/rubric.
7. Confirm cost/budget estimate.
8. Start bakeoff.
9. Watch candidate progress on the bakeoff page.
10. Review compare screen after the judge verdict is ready.
11. Approve winner or inspect loser. Reject-all and rerun-with-another-model are
    product actions, but their APIs are later scope in the current
    implementation.

Progress view must show:

- One lane/card per candidate.
- Current phase: queued, implementing, verifying, fixing, complete, failed,
  blocked, or canceled.
- Attempts, fix rounds, review passes, verification failures, elapsed time, and
  artifacts available so far.
- Operator-visible token/cost accumulation. This must not be shown to the judge.
- Verification state and latest blocking reason.
- Live leaderboard placeholder as candidates finish. Final winner remains
  pending until all candidates are terminal and the judge task completes.
- Judge task state once candidates are ready for review.

Compare screen must show:

- Candidate cards side by side.
- Builder Agent/model/provider.
- Attempt status.
- Diff view per candidate.
- Cost/tokens table.
- Verify status and logs.
- Review status.
- Review passes.
- Fix rounds.
- Verification failures.
- Runtime snapshot/artifacts link.
- Reviewer notes.
- Eligibility result.
- Raw metrics.
- Category scores.
- Overall score.
- Winner badge.
- Operator actions: approve winner and inspect loser in the current MVP.
  Reject-all and rerun-with-another-model should appear as disabled/coming-next
  actions until their API/lifecycle support exists.

Recommendation:

- Compare screen is the center of the product.
- Progress and compare should live in the same dashboard flow so the operator
  can watch the bakeoff mature into a final verdict.
- Default sort should be winner first, then eligible score descending, then
  ineligible candidates grouped below.
- Losers stay inspectable until cleanup/archive is recorded.

Tradeoffs:

- Rich compare view takes longer than CLI-only MVP, but it is the actual value
  of the feature.
- Diffs, test logs, costs, and score tables must be dense but readable.

Unresolved questions for Arnold:

- Should the compare view be a Spec detail tab or a dedicated Bakeoff page?
- Should operator actions live on the compare screen only, or also on task/run
  details?

### 7. CLI Flow

CLI should support the same workflow without becoming the only product surface.

Implemented CLI shape:

```text
ductum spec bakeoff create <projectName> <name> \
  --prompt-file <path> \
  --builders <a,b,c> \
  [--reviewer <reviewer>] \
  [--policy quality-gated-cost-aware] \
  [--repository-id <id>] \
  [--component-id <id>] \
  [--verify <cmd>]

ductum spec bakeoff compare <specId>
```

Recommendation:

- CLI create should mirror dashboard fields.
- CLI builder and reviewer values must be validated against Factory/Project
  Agents. Validation must reject unknown Agents, fewer than two builders, more
  than five builders, duplicate identical model/config candidates, and any
  reviewer model that matches a builder model.
- CLI compare should print the same raw metrics and scores in table form.
- CLI should stay small. Current MVP has create and compare. The API exposes
  status/compare as the same payload; a dedicated CLI status command can be
  added only if it proves useful.
- Approval should use the existing Ductum approval command/path after compare
  identifies the winning attempt. Best-of-N should print that next command
  rather than adding a second approval surface.
- Reject-all is not an MVP CLI command. Failed candidates and no-winner outcomes
  should come from the judge verdict and normal outcome evidence.
- Rerun is later scope, not implemented in the current CLI/API.

Unresolved questions for Arnold:

- What exact Agent selector should CLI accept: Agent name, Agent id, or both?

### 8. Lifecycle

Recommended lifecycle:

1. Operator creates a `best_of_n` Spec.
2. Ductum creates candidate Tasks, one per builder.
3. Candidate Attempts execute independently.
4. Each candidate records implementation, verify, cost, token, review/fix, and
   artifact evidence.
5. Ductum updates progress/leaderboard data as candidates finish, but waits for
   all candidate Attempts to reach a terminal state before final judging.
6. Ductum creates or releases the Best-of-N judge Task.
7. Judge emits blind quality findings and winner reasoning.
8. Ductum records the structured verdict with measured metrics and computed
   cost-efficiency.
9. Operator reviews compare screen.
10. Operator approves winner or inspects losers in the current MVP. Reject-all,
    rerun, and operator override are later lifecycle surfaces.
11. Existing approval/merge flow merges the winner.
12. Losers are archived/cleaned after the winner is selected and loser outcome
    evidence exists.

Recommendation:

- Candidate branches/worktrees remain until a winner and loser outcomes are
  recorded.
- Loser cleanup should happen after winner selection, and it must be explicit
  and auditable.
- Winner merge must remain normal Ductum approval, not a special merge path.

Unresolved questions for Arnold:

- Should canceled/timeboxed candidates count as terminal for judge release in
  MVP, or should the operator explicitly stop waiting?

### 9. Non-Goals

- No Operation tables.
- No WorkOrder tables.
- No YAML.
- No auto-merge bypassing approval.
- No prose-only winner selection.
- No UI-less MVP claim.
- No broad provider/model redesign.
- No deployment hardening in this feature.
- No dashboard redesign beyond the create/compare surfaces needed here.

### 10. Staged Implementation Plan

P1 metadata/contracts: implemented in the current working tree.

- Add typed Spec/Task strategy metadata.
- Add public DTOs.
- Add migrations and tests.

P2 creation API/CLI: implemented in the current working tree.

- Add API and CLI creation surfaces after dashboard shape is accepted.
- Enforce builder/reviewer constraints.

P3 structured verdict: implemented in the current working tree.

- Define and validate verdict evidence.
- Reject prose-only winner selection.

P4 scoring/metrics aggregation: implemented in the current working tree.

- Aggregate tokens, cost, elapsed time, attempts, review passes, fix rounds, and
  verification failures.
- Compute eligibility and score.

P5 dashboard create flow: implemented in the current working tree.

- Add dashboard create Best-of-N flow with builder/reviewer/policy pickers.

P6 dashboard compare flow: implemented in the current working tree.

- Add side-by-side compare view with diffs, metrics, scores, verdict, and
  actions.

P7 lifecycle/approval/cleanup: partially implemented.

- Route winner to normal approval.
- Record loser outcomes.
- Archive/cleanup losers after winner selection and loser outcome evidence
  exists. This cleanup/archive portion is still later scope.

P8 dogfood/browser verification: partially complete.

- Tests/builds pass in the current working tree.
- Browser smoke confirms dashboard/API load and connect.
- One real Ductum Best-of-N dogfood spec has not been run yet because the local
  DB used for browser smoke did not contain project/spec data.

## Summary Recommendation

Build Best-of-N as a dashboard-first compare workflow. The core value is not
running N agents; it is making the operator confident about which eligible
implementation is best by showing quality, process, cost, tokens, review, fix,
verify, and artifact evidence in one place.
