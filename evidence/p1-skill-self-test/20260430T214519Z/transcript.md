# Ductum CLI Skill — Self-Test Transcript

Timestamp: 2026-04-30T21:45:19Z
Skill under test: `.claude/skills/ductum-cli/SKILL.md`
Knowledge corpus: SKILL.md + AGENTS.md only.

Alias used (conceptual):
```sh
export DUCTUM="DUCTUM_OPERATOR_TOKEN=skilltest123 node packages/cli/dist/index.js --api-url http://127.0.0.1:4101"
```

---

## Step 1 — Import a sample 1-task spec

Skill reference: `## Intake a spec` → `$DUCTUM spec import <path> --project <p>`.

Command:
```sh
$DUCTUM spec import /tmp/ductum-skill-selftest/sample-spec.yaml --project skilltest
```

Output (trimmed):
```
Warning: Spec sample-1task is missing a Decision Trace.
Warning: Spec sample-1task is missing Verification.
...
| Spec sample-1task | missing | missing | missing | missing | missing |
| Task write-hello  | missing | missing | missing | missing | missing |
Spec: skilltest/sample-1task
Path: /tmp/ductum-skill-selftest/sample-spec.yaml
Blocked: contract incomplete; task import not run.
Use spec intake for the normal audited path, or pass --waive-contract when an operator explicitly accepts the gap.
Next:
  ductum spec contract-check skilltest /tmp/ductum-skill-selftest/sample-spec.yaml --path
  ductum spec intake skilltest /tmp/ductum-skill-selftest/sample-spec.yaml --import
  ductum spec import /tmp/ductum-skill-selftest/sample-spec.yaml --project skilltest --waive-contract
Error: Spec sample-1task contract is incomplete; import not run
```

Note: Command did exactly what the skill said it would — `spec import` ran the contract check and refused due to incomplete contract, suggesting `--waive-contract` (also in the skill). The pre-seeded import had presumably waived. Skill matched behavior.

---

## Step 2 — Watch the dispatcher pick up the task

Skill reference: `## Dispatch a task and approve it` → `$DUCTUM queue`, `$DUCTUM dispatcher status`, `$DUCTUM dispatcher cycle`.

Commands:
```sh
$DUCTUM queue
$DUCTUM dispatcher status
$DUCTUM dispatcher cycle
```

Output (trimmed):
```
# queue
approvalsWaiting: 1
activeRuns: 2
readyTasks: 0
...
skilltest/write-hello/DNz83T  Awaiting approval  awaiting_approval  builder  ...  approve DNz83TDTB0SB
skilltest/write-hello/euhnEF  Running           implement          builder  ...  status euhnEFDmqPVt

# dispatcher status
state: enabled, running
activeRuns: 0/3
lastCycleAt: 2026-04-30T21:46:03.383Z
adapters: 4 (claude-agent-sdk, codex-app-server, codex-sdk, copilot-sdk)

# dispatcher cycle
tasksEvaluated: 0
tasksDispatched: 0
dispatched: none
errors: 0
```

Note: All three commands worked exactly as the skill described. Dispatcher is reachable and a manual cycle is exposed. As the harness has no real adapter wired up, no dispatch occurred — expected per the test brief.

---

## Step 3 — Approve a passing review

Skill reference: `## Dispatch a task and approve it` → `$DUCTUM approve <runId>`.

Command:
```sh
$DUCTUM approve DNz83TDTB0SB
```

Output:
```
Run DNz83TDT approved → merged (no branch) (no commit)
```

Note: Command did what the skill said — approval succeeded. The "no branch / no commit" message reflects the fixture (placeholder branch/commit data); the merge step was a no-op rather than a hard failure. Skill behavior matched.

---

## Step 4 — Recover one stuck run with `operator-ship`

Skill reference: `### Verified work, but the reviewer chain cannot produce a clean verdict` → `$DUCTUM operator-ship <runId> --reason ...`.

Command:
```sh
$DUCTUM operator-ship euhnEFDmqPVt --reason "skill self-test: stuck implement run with verified branch+commit, advancing to ship"
```

Output:
```
Run euhnEFDm advanced to ship
branch: feature/skilltest-stuck
commit: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
stage: ship
pendingApproval: true
next: approve euhnEFDmqPVt
```

Note: Exactly as the skill described — `operator-ship` advanced the run to `ship`, set `pendingApproval=true`, and printed the next CLI command (`approve <runId>`). Worked first try.

---

## Step 5 — Mark a failed spec failed

Skill reference: `### Spec is dead — work was abandoned or superseded` → `$DUCTUM spec set-status <specOrName> failed [--project <p>]`.

Command:
```sh
$DUCTUM spec set-status 8OxayCGwhZiq failed --project skilltest
```

Output:
```
id: 8OxayCGwhZiq
name: abandoned-spec
status: failed
```

Note: Exactly as the skill said. `failed` is a real terminal status and `spec set-status` accepts the spec id plus `--project`.
