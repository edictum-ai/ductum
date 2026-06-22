# Deferred Work Register

Last reviewed: 2026-04-30

This register maps remaining deferred product work from the active decisions to
concrete Ductum tasks. Closed dogfood blockers move to the review notes below
instead of staying in the active table.

## Active Deferred Work

| Area | Source | Current status | Ductum task |
| --- | --- | --- | --- |
| Pi SDK harness spike | decisions/052, decisions/058 | Blocked. There is still no Pi package in the lockfile, no Pi adapter exported from `@ductum/harness`, and no normal Factory Settings path that can select Pi today. Keep this blocked until the registry/canonical-event path is fully real and Pi can be exported, tested, and selected through normal Factory Settings. | `pi-sdk-spike-adapter` |
| Harness registry and canonical events | decisions/054, decisions/057, decisions/080 | Partially landed. `@ductum/harness` now exports `loadBuiltInHarnessAdapters()` and canonical event helpers for Claude/Codex/Copilot. The old OpenCode adapter family has been retired; keep this open for future supported harnesses such as Pi. | `harness-registry-canonical-events` |
| Sandbox driver matrix | decisions/056, decisions/057, decisions/077, decisions/081 | Host/worktree runtime is real and now blocks live factory DB shell access plus pre-`implement` shell file mutation, but Docker/Podman/isolated drivers and host/worktree network, credential, resource, mount, and process enforcement still fail loud as unsupported. | `sandbox-driver-matrix` |
| Design-to-spec CLI pipeline | decisions/059, decisions/060 | First intake/import gate is implemented: `ductum spec intake <project> <path> --import` audits Behavior Contract / Slop Review coverage and blocks task import unless clean or explicitly waived. Grill/revise/compile remain deferred. | `design-to-spec-cli-pipeline` |
| Decision drift gates | decisions/060, decisions/066, decisions/108 | `spec intake` and legacy `spec import` now block incomplete Decision Trace / Behavior Contract / Slop Review coverage unless the operator passes `--waive-contract`. Remaining runtime enforcement for pre-existing or hand-created tasks stays separate so Ductum does not grow a second policy engine. | `decision-drift-gates` |
| Agent-first run loop | specs/CURRENT.md, decisions/053, decisions/059, decisions/108 | The core loop is landed through `ductum status` next-action guidance, but keep the umbrella task open until a fresh `ductum start --no-browser` bootstrap can repeat `spec intake --import`, Attempt start, approval handling, and repair checks without manual recovery. | `agent-first-run-loop` |
| Product distribution readiness | specs/CURRENT.md, decisions/058 | Clean-copy Docker Compose startup and `.env.local` token bootstrap are landed. Keep the umbrella task open until an outsider rerun proves `docker compose up --build`, `pnpm serve`, `README.md`, `docs/SETUP.md`, and `docs/CLI_ONBOARDING.md` all match the real flow without hand fixes. | `product-distribution-readiness` |

## Explicit Non-Goals For Now

These are not scheduled until a dogfood scenario proves the current primitives
break:

| Deferred item | Source | Reason |
| --- | --- | --- |
| New `Operation` or `WorkOrder` tables | decisions/053, decisions/058, specs/CURRENT.md | Multi-repo work must first be modeled as fan-out specs and target-scoped tasks. |
| New `DesignSession` table | decisions/059 | Planning is a spec workflow over existing decisions, approvals, evidence, tasks, and runs. |
| Second policy system | decisions/058, decisions/060, decisions/108 | Edictum remains the policy engine. Ductum coordinates and records state. |
| Full OpenShell clone or Kubernetes-style gateway | decisions/057, decisions/058 | Reference systems are pattern libraries, not product requirements. |
| Credential vault | decisions/057, decisions/058, decisions/081 | Credential refs are part of the model direction, but vault and mounting behavior are not needed for the current dogfood loop. |
| Provider marketplace or generic plugin marketplace | decisions/055, decisions/058, decisions/079, decisions/080 | Current runtime needs explicit small seams, not a marketplace. |
| Full provider option descriptor UI | decisions/057, decisions/058 | Useful later for settings, but not required for the current factory loop. |
| Settings change streams | decisions/057, decisions/058 | Server-authoritative validation comes first. |
| `inference.local` routing | decisions/057, decisions/058 | Leave room in model/harness shapes without implementing runtime inference routing now. |
| `toolsRef` runtime behavior | decisions/088, decisions/108 | Stored metadata only until a separate dogfood case and decision keep Edictum as the policy boundary. |
| `policyRef` runtime enforcement | decisions/088, decisions/108 | Stored metadata only; no second policy path. |
| Slack, email, GitHub comment, desktop push backends | decisions/055, decisions/079 | Telegram is the only runtime-active backend today. No imported dogfood task currently needs another backend. |
| Docker, Podman, remote, microVM, cloud sandbox drivers | decisions/056, decisions/058, decisions/081 | Keep `sandbox-driver-matrix` focused on truthful host/worktree behavior before broadening drivers. |
| Network, CPU, memory, mount, credential, or process enforcement | decisions/056, decisions/081 | Host/worktree still does not implement these controls. Unsupported claims must keep failing loudly. |

## Merged Or Closed In This Dogfood Loop

- `notification-backend-interface` is merged. Telegram runtime can now resolve
  `telegram.channelRef` into a factory-scoped `NotificationChannel`, enforce
  channel-owned config, and route delivery through `NotificationBackend`.
- `sandbox-driver-matrix` already closed the two live shell-boundary blockers
  exposed by dogfood: `sandbox-shell-db-access-gap` blocks direct shell access
  to the configured factory DB path, sidecars, and `DUCTUM_DB_PATH`; shell file
  mutation before `implement` is now blocked with `tool.command_blocked`
  evidence.
- Codex shell-read follow-ups are landed in code: read-only shell loops now
  emit canonical `Read` evidence, and read-shaped shell authorization now passes
  `{ file_path }` so path scope still applies.
- `approval-state-safety-guard` and `approval-deny-resume-gap` are landed.
  Stale approvals fail closed, denial leaves a retryable failed run, and stale
  approval CLI guidance now points at `ductum deny ...` before retry instead of
  printing a blocked retry command.
- The current execution-integrity follow-ups from
  `agent-first-factory-readiness` are landed on `main`: bakeoff review outcome
  truthfulness, reconcile lineage/outcome handling, external close/retry
  handling, and boundary/performance batching.
- `agent-first-run-loop` now uses `ductum status` as the public next-action surface.
- `product-distribution-readiness` already closed token bootstrap and the first
  clean-copy Docker startup path. The remaining work is repeatable outsider
  reruns, not a missing first-run path.
- Pi remains blocked. There is still no exported, tested, normal-config Pi
  harness path in this repo.
