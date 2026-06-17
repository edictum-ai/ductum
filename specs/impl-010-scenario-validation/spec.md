# impl-010: Scenario-Based Validation

**Status:** Draft
**Priority:** High — this is what makes enforcement meaningful, not just structural
**Depends on:** impl-009 (Edictum governance layer must be source of truth first)
**Inspired by:** StrongDM Software Factory (scenario holdouts, Digital Twin Universe, satisfaction testing), OpenHands SDK (action risk analysis), Stanford CodeX critique (same-model evaluation weakness)

## The Thesis

> Edictum ensures agents follow the workflow. Scenarios ensure the workflow
> produces correct software. Without scenarios, enforcement is structural
> correctness without semantic correctness — the agent followed all the steps
> but the code doesn't actually work.

Enforcement answers: "Did the agent follow the rules?"
Validation answers: "Did the agent produce the right thing?"

You need both. Ductum has enforcement (Edictum). It doesn't have validation.

## Problem

Ductum's verification stages (`local-verify`, `external-review`, `ci-green`) currently
rely on two things:

1. **In-repo tests** — `pnpm test`, `pytest`, `go test`
2. **Agent self-reporting** — the agent calls `ductum_evidence(type, payload)`

Both are gameable:
- The agent writes the code AND the tests. It can write tests that pass trivially.
- `return true` passes all narrowly-written unit tests.
- The agent controls what evidence it reports. It can omit failures.
- The same model that wrote the code is the one evaluating whether it works.

StrongDM identified this exact problem and solved it with three techniques:
1. **Scenario holdouts**: end-to-end user stories stored OUTSIDE the codebase,
   invisible to the implementing agent, evaluated by a separate process.
2. **Digital Twins**: behavioral clones of external services for testing without
   production dependencies (rate limits, costs, flaky APIs).
3. **Satisfaction testing**: probabilistic validation where an LLM judge evaluates
   whether observed behavior satisfies user expectations, not just whether tests pass.

## Architecture

### Scenario holdouts

Scenarios are stored in the Ductum project config, NOT in the target repo.

**Isolation caveat:** The current harness launches agents with `bypassPermissions`
and a cwd pointing at the repo. The agent CAN read files outside its worktree
(including the ductum root where scenarios live). True filesystem isolation
requires impl-008 (containerized execution) or a restricted filesystem view.

For now, the holdout is **organizational, not technical**: scenarios are in
a separate directory that agents are not told about and have no reason to read.
The system prompt does not mention scenario file paths. This is a soft holdout —
sufficient for honest agents, not sufficient against adversarial ones.

For the ductum project specifically, scenarios are in the same repo. This is
acceptable for self-validation but NOT the model for other projects. Other
projects' scenarios should be in the ductum root (scenarios/faceless/), which
is outside the target repo's worktree.

```yaml
# ductum.yaml
projects:
  faceless:
    repos:
      - path: /path/to/faceless
        name: faceless
    scenarios:
      path: scenarios/faceless/    # relative to ductum root
      evaluator: claude-haiku      # cheap model for evaluation
      threshold: 0.90              # 90% scenario satisfaction required
```

```
ductum/
  scenarios/
    faceless/
      s001-basic-pipeline.yaml
      s002-error-handling.yaml
      s003-cli-help.yaml
```

Each scenario:
```yaml
# scenarios/faceless/s001-basic-pipeline.yaml
name: basic-video-pipeline
description: |
  A user runs `faceless generate --topic "AI trends" --duration 60`
  and expects a 60-second video file in the output directory.
  
steps:
  - action: "Run CLI command: faceless generate --topic 'AI trends' --duration 60"
    expect: "Command exits with code 0"
  - action: "Check output directory"
    expect: "Contains exactly one .mp4 file"
  - action: "Verify video duration"
    expect: "Video is between 55 and 65 seconds long"
    
evaluation: llm-judge    # or: command, script, hybrid
tags: [smoke, cli, pipeline]
```

### Scenario evaluation flow

When the workflow reaches `local-verify`:

```
1. Edictum's local-verify exit gate requires command_matches evidence
   (verify commands like pnpm test from the repo profile — this is Edictum's job)
2. AFTER Edictum's gate is satisfied, Ductum runs scenario validation
   as a DUCTUM-LEVEL gate (not an Edictum gate — see note below)
3. Scenarios execute in a read-only git snapshot:
   - git stash + git checkout at current commit in a temp dir
   - NOT in the agent's live worktree (isolation)
   - If impl-007 worktrees are available, use a read-only worktree
4. For each scenario:
   a. Execute steps (command, llm-judge, script, or hybrid)
   b. Record: { scenario, passed, satisfaction: 0-1, reasoning }
5. Aggregate satisfaction score
6. If score >= threshold: record as Ductum evidence, allow advancement
7. If score < threshold: block advancement, agent sees failure details
8. Agent must fix and re-verify
```

**Critical: Scenarios are a DUCTUM gate, not an Edictum gate.**

@edictum/core's exit conditions only support: `stage_complete`, `file_read`,
`command_matches`, `command_not_matches`, `exec`, `approval`.
`recordWorkflowResult()` only persists Read (file_path) and Bash (command)
evidence. There is no custom evidence type or tool_pattern matcher.

So scenario validation is implemented as a Ductum-level post-gate:
- Edictum handles tool-level enforcement and command_matches exit gates
- After Edictum's local-verify gate is satisfied (tests ran), Ductum checks scenarios
- Ductum blocks the run from advancing if scenarios fail
- Scenario results stored in Ductum's evidence table (not Edictum's workflow state)
- This is enforced in `recordToolSuccess()` in enforce.ts

### Cross-model evaluation (the Stanford defense)

The implementing agent and the evaluating judge MUST be different:

The scenario judge is NOT a Ductum agent — it does not use a harness adapter.
It is a direct API call to the Anthropic API (or OpenAI for non-Claude models)
inside `packages/core/src/scenario-judge.ts`. No agent registration, no harness,
no tool access. Just an LLM API call with a structured prompt and JSON response.

The evaluator model is configured per-project in ductum.yaml:
```yaml
projects:
  faceless:
    scenarios:
      evaluator: claude-haiku-4-5   # model for LLM judge calls
```

Why Haiku for evaluation?
- Cheaper (scenarios run often)
- Different model = different failure modes (Stanford's "mismatch" principle)
- Fast (evaluation shouldn't block for minutes)
- Sufficient for "does this output match the expected behavior?" judgments

The evaluator never sees the implementation. It only sees:
- The scenario description
- The observed output from running the scenario steps
- The expected outcome

This is the holdout principle: the evaluator can't be gamed because it has no
access to the code, the tests, or the implementing agent's reasoning.

### Satisfaction scoring

Instead of boolean pass/fail, scenarios produce satisfaction scores:

```typescript
interface ScenarioResult {
  scenarioId: string
  scenarioName: string
  passed: boolean           // hard pass/fail
  satisfaction: number      // 0.0 - 1.0 (LLM judge confidence)
  reasoning: string         // why it passed or failed
  duration_ms: number       // how long evaluation took
  evaluator: string         // which model judged
}

interface ValidationSummary {
  totalScenarios: number
  passed: number
  failed: number
  overallSatisfaction: number  // weighted average
  threshold: number
  verdict: 'pass' | 'fail'
  results: ScenarioResult[]
}
```

This becomes Ductum evidence (NOT Edictum workflow state):
```typescript
// Store in Ductum's evidence table
evidenceRepo.create({
  runId,
  type: 'scenario-validation',
  payload: validationSummary,
})
```

### Digital Twins (future, but architect for it now)

For projects that depend on external services, scenarios can reference twins:

```yaml
# scenarios/myproject/s005-okta-login.yaml
name: okta-login-flow
twins:
  - service: okta
    twin: twins/okta-mock/
    port: 9443
steps:
  - action: "Start twin services"
    expect: "Okta mock running on :9443"
  - action: "Run login flow against mock"
    expect: "User authenticated, token returned"
```

Not in scope for this spec, but the scenario format supports it from day one
so the YAML schema doesn't need breaking changes later.

## Integration with impl-009 (Edictum Governance)

Scenarios plug into Edictum's evidence system at three stages:

| Workflow stage | Scenario role |
|----------------|---------------|
| `local-verify` | Run all scenarios, require threshold satisfaction |
| `external-review` | Scenarios provide context for human reviewer |
| `ci-green` | Re-run scenarios in CI environment |

The `local-verify` Edictum exit gate stays as-is (command_matches for verify commands).
Scenario validation is a Ductum-level check that runs AFTER Edictum's gate passes.
No changes to the workflow YAML or @edictum/core for scenarios.

## Integration with existing evidence system

Scenario results are stored as Evidence records:

```sql
INSERT INTO evidence (run_id, type, payload, created_at)
VALUES (?, 'scenario-validation', ?, datetime('now'))
```

The payload is the full `ValidationSummary` JSON. The dashboard can render:
- Scenario pass/fail badges per run
- Satisfaction trend across retries (did the agent improve?)
- Failed scenario details (expandable)

## MCP tool changes

Add one new tool for agents to see scenario results (read-only):

```
ductum_scenarios() → returns scenario validation results for current run
```

The agent does NOT run scenarios. The system runs them automatically at the
`local-verify` gate. The agent can only read results to understand what failed.

## Key design principles

1. **Agents are not told about scenario definitions** — they see results only (organizational holdout, not filesystem-enforced; true isolation requires impl-008 containers)
2. **Evaluator is always a different model** than the implementer
3. **Scenarios are per-project**, not per-task (they validate the whole project)
4. **Threshold is configurable** — 0.90 is a reasonable default
5. **Scenarios are append-only** — adding scenarios makes the bar higher, never lower
6. **Failed scenarios produce actionable feedback** — the agent knows WHAT failed
7. **Scenario evaluation is automated** — no human needed at local-verify

## Files to create/modify

| File | Change |
|------|--------|
| packages/core/src/scenarios.ts | NEW: Scenario loader, runner, evaluator |
| packages/core/src/scenario-judge.ts | NEW: LLM-as-judge evaluation |
| packages/core/src/types.ts | Add ScenarioResult, ValidationSummary, ProjectScenarioConfig types. **Add scenarios field to ProjectConfig** (currently only has mergeMode, workflowPath). |
| packages/core/src/enforce.ts | Wire scenario validation as Ductum post-gate at local-verify |
| packages/mcp/src/server.ts | Add ductum_scenarios read-only tool |
| packages/api/src/routes/runs.ts | Expose scenario results in run detail |
| **packages/api/src/routes/projects.ts** | **Accept scenarios config in project creation/update (line ~18)** |
| packages/dashboard/src/pages/RunDetail.tsx | Scenario results panel |
| ductum.yaml | Add scenarios config per project |
| **scripts/serve.mjs** | **Seed scenarios config from ductum.yaml (line ~164 currently only seeds mergeMode/workflowPath)** |
| scenarios/ | NEW: directory for project scenarios |

## Acceptance Criteria

1. Scenarios load from `scenarios/<project>/` directory
2. Agent is not given scenario file paths (organizational holdout)
3. At `local-verify`, scenarios run automatically
4. LLM judge evaluates each scenario with satisfaction score
5. Overall satisfaction below threshold blocks stage advancement
6. Agent receives failure details and can iterate
7. Evaluator model is different from implementing model
8. Scenario results stored as Evidence records
9. Dashboard shows scenario results per run
10. Re-verification after fixes shows improvement trend

## Decisions

- D44: Scenarios stored in ductum root, never in target repo (holdout principle)
- D45: Evaluator model must differ from implementer model (Stanford defense)
- D46: Satisfaction is probabilistic (0-1), not boolean
- D47: Scenarios are per-project, evaluated at local-verify gate
- D48: Agents see results but never definitions (read-only via MCP)
- D49: Digital twin support in YAML schema from day one (implementation deferred)
