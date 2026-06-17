# Factory Settings Source Of Truth

## Status

Locked planning model. Do not implement from this document until a separate
stage prompt names scope and verification.

## Problem

The current Settings page still edits and displays `ductum.yaml`, while the live
Factory is SQLite plus runtime APIs. That makes Settings misleading: the YAML
can show old init projects, agents, and config while `/api/projects`,
`/api/agents`, and `/api/factory-settings` show the real Factory.

## Locked Decisions

- `ductum.yaml` is removed from normal operation.
- `ductum init` writes directly to SQLite.
- No legacy migration path is needed for this redesign. We start fresh.
- The Settings UI edits live DB/runtime APIs, not files.
- The raw YAML editor is removed from Settings.
- `/api/settings/config` is not a normal Settings endpoint.
- Secrets are encrypted, write-only, masked in all read APIs, and resolved only
  by authorized runtime paths.
- Telegram is deferred to a later stage. Do not build Telegram-specific settings
  in this pass.
- Factory Settings owns the normal operator model:
  Factory -> Project -> Repository/Component -> Spec -> Task -> Attempt.
- Legacy Target/YAML/resource mental models must not re-enter the normal UI.

## Reference Patterns

These are reference patterns only, not product requirements.

- Vercel keeps environment variables outside source, stores them encrypted at
  rest, exposes dashboard/CLI/API management, and applies changes to future
  deployments rather than already-running deployments.
- Netlify secret values are write-only after creation, masked from UI/CLI/API,
  scoped explicitly, and still injected into allowed runtime contexts.
- Fly.io stores app secrets in an encrypted vault and injects them into Machines
  as runtime environment variables; secret updates restart Machines.
- Conduktor supports environment-variable substitution in manifests to keep
  credentials out of config files, but Ductum should not keep YAML as the live
  operator surface.

Sources:

- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/environment-variables/managing-environment-variables
- https://docs.netlify.com/build/environment-variables/secrets-controller/
- https://fly.io/docs/apps/secrets/
- https://docs.conduktor.io/guide/conduktor-in-production/automate/cli-automation

## Config Layer Model

### DB Authoritative State

SQLite is authoritative for:

- Factory name and operator defaults.
- Desired restart-aware runtime settings.
- Projects.
- Repositories and Components.
- Agents and Project Agent assignments.
- Providers and Models.
- Harnesses.
- WorkflowProfiles.
- SandboxProfiles.
- NotificationChannels, excluding Telegram implementation details until the
  deferred Telegram stage.
- Budgets and routing preferences.
- Worktree configuration.
- Encrypted Secret metadata and ciphertext.

### Process Runtime State

Runtime state is what the currently running process is actually using.

Examples:

- API bind host and port.
- Public API URL.
- Dashboard URL.
- DB path.
- Factory data directory.
- Dispatcher running/enabled state.
- Heartbeat interval actually loaded into the running dispatcher.
- Notification/webhook runtime state.
- Harness child-process environment.

Settings may edit desired values for restart-aware process config, but must show
current effective value separately from desired value.

### P0 Storage And Key-Source Locks

Desired restart-aware runtime settings live in a dedicated SQLite table, not in
`factories.config`. Current effective runtime values are process observations;
they are not treated as desired state unless a typed Settings write persists
them. This is recorded in D170.

Local Factory installs use a generated 32-byte key file at
`<factoryDir>/.ductum/secrets.key`, mode `0600`, created during DB-only init.
The key is not stored in SQLite, returned by APIs, or written into YAML. Losing
the key makes encrypted secrets unrecoverable. External KMS, OS keychain
storage, or env-only master keys need a later decision. This is recorded in
D170.

### Built-Ins And Catalogs

Built-ins are derived defaults, not file-backed state.

Examples:

- Built-in workflow presets.
- Built-in harness adapter descriptors.
- Built-in provider descriptors.
- Built-in model registry entries from `packages/core/src/model-registry-data.ts`.

At init, Ductum should seed or expose the current model catalog through DB/API
so the UI can show all available models without a YAML edit. The implementation
stage must refresh concrete provider/model IDs from official provider sources
before adding or changing model IDs, pricing, or availability flags.

P8 model catalog refresh notes, checked 2026-06-13:

- OpenAI sources: https://developers.openai.com/codex/models and
  https://developers.openai.com/api/docs/models/all plus per-model pages under
  `https://developers.openai.com/api/docs/models/`.
- Anthropic sources:
  https://platform.claude.com/docs/en/about-claude/models/overview,
  https://platform.claude.com/docs/en/about-claude/pricing, and
  https://code.claude.com/docs/en/model-config.
- Z.AI sources: https://docs.z.ai/guides/overview/pricing,
  https://docs.z.ai/devpack/tool/claude,
  https://docs.z.ai/devpack/latest-model, and https://docs.z.ai/devpack/faq.
- `gpt-5.3-codex-spark` stays in the catalog as `research-preview` and
  explicitly unmeasured because OpenAI Codex docs list availability but do not
  publish token pricing.
- OpenAI `gpt-5.5-pro` and `gpt-5.4-pro` stay catalog-visible with measured
  API pricing, but have no supported Ductum harness until a concrete route is
  proven.
- `o3-mini` remains API-available; only its dated `o3-mini-2025-01-31`
  snapshot is deprecated in OpenAI docs.
- Claude Mythos 5 is not added because Anthropic lists it as limited
  availability to approved customers.
- Claude Fable 5 remains visible as a deprecated catalog row but is not
  routable. Anthropic's June 12, 2026 update suspended Fable/Mythos access and
  directs users to Opus 4.8 or another model.
- Z.AI Claude-harness support is limited to the GLM Coding Plan models Z.AI
  documents for Claude Code mapping: `glm-5.2`, `glm-5.1`, `glm-5-turbo`,
  `glm-4.7`, and `glm-4.5-air`. `glm-5.2` uses the operator-selected GLM-5.1
  pricing policy until Z.AI publishes separate public token pricing. For GLM-5.2
  through Claude Code, low/medium/high effort maps to GLM high effort and
  xhigh/max maps to GLM max effort; Ductum does not yet model Claude Code's
  `ultracode` effort as a typed Agent effort. Other Z.AI API-priced rows remain
  measured but have no supported Ductum harness until a supported route exists.
- Standalone `glm-5v` is not in the refreshed catalog because the official
  Z.AI pricing and VLM docs list `GLM-5V-Turbo`, not `GLM-5V`.

### Secrets

Secrets are encrypted local state, not env refs and not YAML.

Rules:

- Secret values are accepted by create/update APIs.
- Secret read APIs return metadata only: id, name, scope, created/updated time,
  last rotation time, last tested time, and masked status.
- Plaintext is never returned after save.
- Runtime paths request resolved secrets by reference only.
- Logs, evidence, public JSON, exports, and UI never expose plaintext.
- Rotating a secret may require restarting affected runtimes.

## Ownership Table

| Setting | Owner | Editable In Settings | Runtime Effect |
|---|---|---:|---|
| Factory name | SQLite Factory | yes | hot reload for display |
| Default merge mode | SQLite Factory settings | yes | hot reload for new dispatch decisions |
| Merge base/strategy/push | SQLite Factory or Project settings | yes | applies to future merge attempts |
| Heartbeat timeout | SQLite Factory settings | yes | applies to future runs; existing runs keep snapshot |
| Heartbeat interval | Desired runtime settings in SQLite | yes | restart dispatcher/API |
| API bind host | Desired runtime settings in SQLite | yes | restart API |
| API port | Desired runtime settings in SQLite | yes | restart API |
| Public API URL | Desired runtime settings in SQLite | yes | restart notification/webhook runtime if loaded |
| Dashboard URL | Desired runtime settings in SQLite | yes | restart dashboard/process manager if applicable |
| DB path | Startup/process runtime | no normal edit | restart with explicit startup selection |
| Factory dir | Startup/process runtime | no normal edit | restart with explicit startup selection |
| Operator token | Encrypted Secret or external process secret | rotate only | restart/API session impact |
| Token detect flag | Startup/runtime setting | advanced only | restart/auth bootstrap impact |
| Project records | SQLite Projects | yes | immediate for future specs/tasks |
| Repository records | SQLite Repositories | yes | immediate for future task targeting |
| Component records | SQLite Components | yes | immediate for future task targeting |
| Agents | SQLite Agents | yes | future dispatches; active attempts keep snapshot |
| Project Agent assignments | SQLite ProjectAgents | yes | future dispatches |
| Providers | SQLite/catalog descriptors | yes, typed | affects model auth/config resolution |
| Models | SQLite/catalog descriptors seeded from registry | yes, typed | future dispatches |
| Provider auth | Encrypted Secret refs | yes, write-only | restart affected harness/runtime |
| Harnesses | SQLite Harness descriptors | yes, typed | future dispatches; some fields restart runtime |
| Workflows | SQLite WorkflowProfile records | yes | future runs; existing attempts keep snapshot |
| Sandboxes | SQLite SandboxProfile records | yes | future sandbox creation |
| Notification channels | SQLite NotificationChannel records | yes, except Telegram deferred | future notification sends |
| Telegram | deferred | no | later deployment/webhook stage |
| Budgets | SQLite Factory budget settings | yes | hot reload when enforcement reads live budget |
| Worktree enabled/base path | SQLite desired runtime settings | yes | future runs; path changes may require restart/cleanup |

## API Contract Lock

Replace Settings-as-YAML with typed DB-backed APIs:

- `GET /api/factory/settings`
- `PATCH /api/factory/settings`
- `GET /api/factory/runtime`
- `PATCH /api/factory/runtime`
- `GET /api/factory/providers`
- `POST /api/factory/providers`
- `PATCH /api/factory/providers/:id`
- `GET /api/factory/models`
- `POST /api/factory/models`
- `PATCH /api/factory/models/:id`
- `GET /api/factory/harnesses`
- `POST /api/factory/harnesses`
- `PATCH /api/factory/harnesses/:id`
- `GET /api/factory/workflows`
- `POST /api/factory/workflows`
- `PATCH /api/factory/workflows/:id`
- `GET /api/factory/sandboxes`
- `POST /api/factory/sandboxes`
- `PATCH /api/factory/sandboxes/:id`
- `GET /api/factory/notification-channels`
- `POST /api/factory/notification-channels`
- `PATCH /api/factory/notification-channels/:id`
- `GET /api/factory/secrets`
- `POST /api/factory/secrets`
- `PATCH /api/factory/secrets/:id`
- `DELETE /api/factory/secrets/:id`
- `POST /api/factory/secrets/:id/test`

Existing Project, Repository, Component, Agent, Spec, Task, and Attempt APIs
remain normal operator APIs. Settings should use those APIs where the edited
thing is already a first-class operator record.

Factory Settings DTOs live in `@ductum/core`. API routes map repository records
to those DTOs. Dashboard and CLI consumers use typed APIs instead of
YAML-shaped config.

All write responses that affect process state must include:

- `applied`: whether the running process is using the new value now.
- `restartRequired`: whether a restart is needed.
- `affectedRuntimes`: API, dashboard, dispatcher, harnesses, notifications, or
  active attempts.
- `current`: current effective value when different from desired value.
- `desired`: persisted desired value.

## UI Behavior Proposal

Settings should become typed panels:

- Factory: name, defaults, budgets, worktree defaults.
- Runtime: current vs desired process settings and restart requirements.
- Providers and Models: provider auth status, model availability, supported
  efforts/options, pricing/routing metadata.
- Harnesses: adapter type, command/runtime, supported features, secret refs,
  restart behavior.
- Agents: role/persona, model, harness, sandbox, workflow permissions,
  capabilities, budgets, secret access.
- Workflows: saved workflow profiles and validation state.
- Sandboxes: provider/mode/policy/resources.
- Secrets: create, rotate, delete, test, masked status.
- Advanced: startup paths and debug-only compatibility state, read-only unless a
  later prompt defines a safe edit flow.

The UI must not include:

- Raw YAML editor.
- `ductum.yaml` file path.
- Legacy `targets` as normal project configuration.
- Telegram controls in this pass.
- Plaintext secret display after save.

## Better Agent, Harness, And Model Config

Agent config must be structured around the work Ductum assigns, not raw model
strings.

Agent fields:

- name
- role/persona
- modelRef
- harnessRef
- sandboxRef
- workflowProfileRef or workflow permissions
- capabilities
- tool/policy refs
- secret access refs
- cost tier/routing preference
- budget caps
- concurrency limit
- enabled state

Harness fields:

- name
- adapter type
- command/runtime
- control mode
- supported sandbox modes
- supported model providers
- required secrets
- environment injection policy
- restart behavior
- health/test command

Model fields:

- Ductum model id
- provider id
- provider model id
- availability type
- supported harnesses
- supported efforts/options
- default effort
- pricing/rate metadata
- scanner/log source
- enabled state
- source URL and last verified date

The model picker should render from this typed catalog and should include newly
available models after the implementation stage refreshes the provider catalog.

## Init Behavior

`ductum init` should create:

- Factory row.
- Desired runtime settings row.
- Secret store metadata/key-source setup.
- Built-in provider descriptors.
- Built-in model descriptors from the refreshed model registry.
- Built-in harness descriptors for installed adapters.
- Built-in sandbox profile.
- Built-in workflow profile.
- Initial Project.
- Initial Repository and optional Components.
- Initial Agents selected during onboarding.
- Project Agent assignments.
- Budget defaults.

It should not create `ductum.yaml`.

## Import/Export Behavior

No legacy migration is required.

Export, if implemented later, is a snapshot/export feature, not live config.
Exports must omit plaintext secrets and must label themselves as snapshots.

Import, if implemented later, must write through the same typed validation path
as the API and must not reintroduce YAML as the live source of truth.

## Non-Goals

- No production code in this planning session.
- No Telegram implementation in this stage.
- No legacy YAML migration path.
- No new CLI commands.
- No new dependencies without a separate supply-chain decision.
- No public Edictum positioning.
- No top-level Operation or WorkOrder tables.
- No claim that Ductum validates test quality or review quality.
- No plaintext secret reads from API/UI/CLI after save.

## Implementation Execution Order

Each stage is intended to fit in one agent session with its own verification
gate. Do not start a later stage until the previous stage has passed or a
decision records the reason for changing order.

| # | Stage | Scope | Danger Level | Status |
|---|---|---|---|---|
| 0 | [P0 - Contradiction Audit And Contract Lock](P0-CONTRADICTION-AUDIT-AND-CONTRACT-LOCK.md) | Audit current contradictions, lock API/storage/security decisions | medium | done/pass |
| 1 | [P1 - DB Schema, Repo, And API Foundation](P1-DB-SCHEMA-REPO-API-FOUNDATION.md) | Add typed DB/repo/API foundation without behavior cutover | high | done/pass |
| 2 | [P2 - Init Writes SQLite Directly](P2-INIT-WRITES-SQLITE-DIRECTLY.md) | Make init create DB-only Factory state and no YAML | dangerous | done/pass |
| 3 | [P3 - Remove YAML Settings And Migration Paths](P3-REMOVE-YAML-SETTINGS-AND-MIGRATION-PATHS.md) | Remove normal YAML Settings/migration/editor paths | dangerous | done/pass |
| 4 | [P4 - Runtime Current Vs Desired Config](P4-RUNTIME-CURRENT-VS-DESIRED-CONFIG.md) | Add honest current/desired runtime config and restart markers | high | done/pass |
| 5 | [P5 - Encrypted Write-Only Secrets](P5-ENCRYPTED-WRITE-ONLY-SECRETS.md) | Add encrypted local secret storage and write-only APIs | dangerous | done/pass |
| 6 | [P6 - Dashboard Settings Typed API Rebuild](P6-DASHBOARD-SETTINGS-TYPED-API-REBUILD.md) | Rebuild Settings on typed APIs with no YAML editor | high | done/pass |
| 7 | [P7 - Agent, Harness, And Model Settings Cleanup](P7-AGENT-HARNESS-MODEL-SETTINGS-CLEANUP.md) | Clarify agent/harness/model config and validation | high | done/pass |
| 8 | [P8 - Model Catalog Refresh Path](P8-MODEL-CATALOG-REFRESH-PATH.md) | Verify and refresh newly available model catalog entries | medium | done/pass |
| 9 | [P9 - Final Dogfood And Onboarding Demo](P9-FINAL-DOGFOOD-AND-ONBOARDING-DEMO.md) | Prove fresh DB-only onboarding and Settings end to end | high | done/pass — see [evidence/](evidence/) |

## Open Questions

- Which process manager, if any, owns restart requests?
- Should Settings offer a restart action later, or only show restart-required
  state?
- Which model providers are in scope for the first catalog refresh beyond the
  current OpenAI, Anthropic, and Z.AI registry?
- Should exports exist at all, or should API-only mutation remain the only
  supported configuration path?
