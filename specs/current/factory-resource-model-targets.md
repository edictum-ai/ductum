# Factory Resource Model - Target Slice

## Intake

Implement the first usable slice of Ductum's declarative factory resource model.
The goal is to make `Target` real before expanding agents, models, harnesses,
sandboxes, notification channels, or fan-out task generation.

## Grill

1. Where does `Target` live?
   Recommended answer: under a project. Code already scopes specs and tasks to
   projects, and decisions `053` and `059` model multi-repo work as project
   specs that emit work.

2. Should tasks receive `target_id` now?
   Recommended answer: not in this slice. Record the why in decision `061` and
   keep the first pass limited to config storage, API, CLI, and dogfood
   artifacts.

3. Should target config store secrets?
   Recommended answer: no. Store only `authRef`; credential material remains
   outside this pass per decisions `053`, `055`, and `058`.

4. Should target resource validation become a policy system?
   Recommended answer: no. Ductum validates shape. Edictum remains the policy
   system per decisions `053`, `058`, and `060`.

## Decisions

- `053`: declarative resource model; `Target` first.
- `054`: harnesses are adapters, not state owners.
- `055`: notification channels are pluggable resources.
- `056`: sandboxing is a first-class resource.
- `057`: reference systems provide seams, not requirements.
- `058`: minimal scope, no reference-system copying, minimal dependencies.
- `059`: design-to-spec is a workflow over specs, decisions, evidence, tasks,
  and runs.
- `060`: generated prompts and reviews need Decision Trace and drift handling.
- `061`: `Target` is persisted before task `target_id` fan-out migration.

## Audit

- AGENTS.md: no `Operation` or `WorkOrder`; keep Edictum as policy system; use
  small verified slices; preserve existing harness paths.
- SECURITY.md: no new dependencies; no scripts; no secret values in target
  manifests; only refs such as `github-default`.
- Code shape: current project/spec/task/run repos use SQLite JSON columns and
  Hono routes. The first target slice should match that shape.
- Drift risk: adding target-like fields because OpenShell or T3 Code has them.
  Blocked by requiring a dogfood flow for every field.

## Smallest Resource Migration

| Resource | First schema | Dogfood flow supported |
|---|---|---|
| Target | `project_id`, `name`, `spec.source`, `spec.branch`, `spec.workflowRef`, `spec.authRef` | Identify where a prompt should run and which workflow profile applies |
| WorkflowProfile | `project_id`, `name`, `path`, `description` | Resolve Edictum workflow files without burying them in projects |
| Harness | `name`, `type`, `command`, `controlMode`, `supportedSandboxes` | Route agents through pluggable adapters |
| Model | `name`, `provider`, `modelId`, `accessRef`, `supportedEfforts` | Separate model selection from agent persona |
| SandboxProfile | `name`, `provider`, `mode`, `filesystem`, `network`, `credentials` | Bind agents to isolation constraints |
| NotificationChannel | `name`, `backend`, `configRefs`, `events` | Make Telegram one backend, not a global special case |

## Compile

Implementation prompts live in `specs/current/factory-resource-model/`.

## Drift

Every prompt and review must include:

- linked active decisions.
- linked non-goals.
- allowed scope.
- expected verification.
- instruction to stop and record a decision, waiver, or amendment if scope must
  expand.

Drift format:

```text
Drift:
- type:
- decision or non-goal:
- changed behavior:
- why:
- evidence:
- status: pending | approved | rejected | waived
```

## Dogfood Evidence

- Applied Edictum target manifests with `ductum target apply`.
- Imported generated prompts with `ductum spec import`.
- Assigned P1 to `codex`.
- Accepted real run `K2FpA1NgVWRY`.
- Recorded decision `Qp7UPv0esANR` for the staged Target/task migration.
- Attached custom evidence `DVJ0jTNjXAFK` with artifact paths and commands.
- Applied resource shell manifests with `ductum resource apply`.
- Accepted real P2 run `ZkhaqT5lnLHa`.
- Recorded decision `WeGK_bKDBKQa` for shared config resource shell storage.
- Attached custom evidence `7wgmnu-qJVrg`.
- Applied dogfood target manifest `specs/current/factory-resource-model/ductum-target.yaml`
  after the fan-out import exposed the missing `ductum` target.
- Imported fan-out dogfood spec `OV1uTAjmObhR`.
- Created target-scoped fan-out task `P--B2pJOyI87`.
- Accepted real P3 run `-HBHAxwGMf0v`.
- Accepted fan-out dogfood run `vzetfPEy4Rx4`.
- Recorded P3 decision `CTQLmPGGoxGM`.
- Attached P3 evidence `sdrrvsgR95Tb`.
- Generated drift review artifact `specs/current/factory-resource-model/decision-drift-review-dogfood.md`.
- Accepted real P4 run `URyeDJEaNHDQ`.
- Recorded P4 decision `z3Ls8ljmsr9H`.
- Attached P4 evidence `8GYxyT6nKbFC`.
