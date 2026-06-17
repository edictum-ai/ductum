# P9 Evidence 05 — Operator Model Proof

A real work request was run through the public operator model on the fresh
DB-only factory, using only `ductum` CLI commands plus typed APIs:

Factory `p9-demo` (seeded at init)
→ Project `p9-demo` (dZSkW9mhqgQZ, seeded)
→ Repository `.` (jO7vgxsG_98G) / Component `root` (B3K_INTz7uLf, seeded)
→ Spec `hello-readme` (uqB03O4btsTT) via
  `ductum spec intake p9-demo packages/ductum/assets/specs/examples/hello-readme --import`
  (contract: complete; 4 decision trace records)
→ Task `P1-HELLO-README` (J04EmNqImYyS, ready)
→ Attempt `NhWqmnq3tbfY` via
  `ductum attempt start P1-HELLO-README --agent codex-builder --project p9-demo`

No Operation or WorkOrder tables exist or were introduced; multi-step state
stayed on Spec/Task/Attempt records.

## Attempt runtime snapshot (GET /api/attempts/:id)

`snapshot.completeness: "full"`, `legacy: false`, captured at dispatch. The
snapshot pins all runtime state the task ran with:

- `agent`: codex-builder, model `gpt-5.4`, harness `codex-sdk`, resourceRefs
  (modelRef/harnessRef/workflowProfileRef `coding-guard` / sandboxRef
  `worktree-default`), capabilities, effort `medium`, costTier 85
- `provider`: openai; `model`: modelId + providerModelId + catalog resource
  id/name; `harness`: harnessId + adapterKey + resource id/name
- `workflow`: the resolved `coding-guard` profile **including the fully
  rendered Edictum workflow YAML** and verifyCommands
- `sandboxProfile`: worktree-default (host/worktree, readWrite worktree,
  host network)
- `execution`: hostId, worktree workingDir/paths under
  `.ductum/worktrees/...`, defaultBranch, branchPrefix
- spec/task/project/repository/component identity

## Live run observations (honest record)

- The codex agent ran governed under coding-guard: understand → implement,
  MCP `ductum.update` progress, `ductum.evidence` attachments, structural
  tool-call interception (`authorize_tool` / `recordToolSuccess`) visible in
  run activity and the API log.
- The agent appended exactly one README line, committed
  `26e529de` on branch `ductum/P1-HELLO-README-NhWqmn`, attached strict
  verification evidence (diff + duplicate-count check), and called
  `ductum.complete` (~80 s wall clock for the agent session).
- Post-completion verification ran the workflow profile's verifyCommands
  (`pnpm build && pnpm test`) and **honestly failed** with
  `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` — the seeded demo repo (the factory
  directory) is not a pnpm project. The factory recorded
  `verify passed:false` evidence and created fixing-mode task
  `fix-P1-HELLO-README-r1` (round 1/3; C7 fixing ≠ implementing).
- The parent attempt then waited on the fix round, hit the heartbeat
  timeout, and the dispatcher honestly marked it
  `heartbeat-stalled — no auto-retry (P3 policy), marked failed` and
  auto-closed 1 stale slot. The streaming CLI exited non-zero with
  `Attempt ... finished: Stalled` — no fake success anywhere.
- Final factory status: 0 active attempts, 1 ready task, **1 stalled attempt**
  truthfully shown, with a concrete next action:
  `ductum attempt start 2eY7bMKlHmr7 --agent codex-builder --project p9-demo`.
  The fix round was intentionally not run: it cannot pass (see finding 1) and
  would only burn agent rounds; the operator path to run it is proven present.

## Findings (recorded, not papered over)

1. **Built-in profile verify commands don't fit the seeded Repository.**
   The built-in `coding-guard` profile hardcodes
   `verifyCommands: ["pnpm build", "pnpm test"]`, and DB-only init seeds the
   factory directory itself as the initial Repository (`.`). A fresh factory
   directory is not a pnpm package, so the out-of-box first dispatch can never
   pass post-completion verification; the fix loop would burn its 3 rounds on
   an unfixable environment mismatch (hello-readme forbids touching files
   other than README.md). Not a source-of-truth defect — every surface
   reported truthfully from DB/typed APIs — but an init-seeding/profile gap.
   Backlog: repo-aware verify commands or a non-pnpm default for the seeded
   factory repo.
2. **Ready fix task did not auto-dispatch; the skip is silent.** After the
   stale slot was closed, the fix task stayed `ready` for >10 minutes with the
   dispatcher polling every 30 s, the assigned agent healthy and free,
   `retryAfter: null`, and no dispatcher error logged. Root cause not
   established this session; the silent `continue` paths in
   `dispatcher-cycle.ts` (matchAgent-null with busy-eligible agent,
   `isWorktreeContested`) make non-dispatch invisible to the operator. The
   status surface compensates honestly (ready task + explicit next action),
   but P1 safety/honesty hardening should make dispatch skips name a reason.
3. **Attempt cost shown as $0.00 / 0 tokens** for the codex-app-server run
   even though a real gpt-5.4 session executed. Possibly subscription-auth
   usage not reported by the harness path. Worth a look during P1 honesty
   hardening (cost surfaces should not understate real usage).
