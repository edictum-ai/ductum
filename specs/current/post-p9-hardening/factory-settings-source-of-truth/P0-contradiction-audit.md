# P0 Contradiction Audit - Factory Settings Source Of Truth

Date: 2026-06-10

Status: complete

Scope: planning/spec/contract audit only. No production code changes are part
of P0.

## Locked Contract Snapshot

- Factory Settings are DB-only after init.
- `ductum init` writes directly to SQLite and creates no `ductum.yaml`.
- No legacy migration path is required for this redesign.
- Settings uses typed DB/runtime APIs, not YAML file editing.
- Secrets are encrypted local state, write-only after save, and resolved only by
  authorized runtime paths.
- Runtime config separates desired persisted values from current effective
  process values and marks restart requirements honestly.
- Telegram-specific Settings UI is deferred.
- Agent, Harness, and Model config must keep Ductum IDs, provider model IDs,
  Agent names, and harness adapter keys distinct.
- Model catalog refresh must verify newly available models from provider
  sources before changing concrete IDs, pricing, or availability.

## P0 Contract Locks

Runtime settings storage: desired restart-aware runtime settings use a dedicated
SQLite table owned by P1, not the existing `factories.config` JSON. Current
effective runtime values are read from the running process, CLI start plan, and
runtime snapshots. They are not treated as desired state unless a typed settings
write persists them. Recorded in D170.

Secret key source: local Factory installs use a generated 32-byte key file at
`<factoryDir>/.ductum/secrets.key`, mode `0600`, created during DB-only init.
The key is not stored in SQLite, not returned by APIs, and is referenced in DB
metadata only by source type and stable key id. Losing the key makes encrypted
secrets unrecoverable; backing up the key with the DB is an operator
responsibility. External KMS, OS keychain storage, or env-only master keys need
a later decision. Recorded in D170.

Typed API ownership: API DTO types live in `@ductum/core`; API routes map repo
records to those DTOs; dashboard and CLI consume the typed API, not YAML-shaped
config. Existing Project, Repository, Component, Agent, Spec, Task, and Attempt
APIs remain normal operator APIs.

## Typed API Surface

| Surface | Request DTO owner | Response DTO owner | Notes |
|---|---|---|---|
| `GET /api/factory/settings` | none | `@ductum/core` Factory settings DTOs | Factory name, defaults, budgets, worktree defaults. |
| `PATCH /api/factory/settings` | `@ductum/core` typed patch DTO | `@ductum/core` typed write result DTO | Includes `applied`, `restartRequired`, `affectedRuntimes`, `current`, and `desired` when process state is affected. |
| `GET /api/factory/runtime` | none | `@ductum/core` runtime current/desired DTOs | Current process facts plus desired DB values. |
| `PATCH /api/factory/runtime` | `@ductum/core` typed runtime patch DTO | `@ductum/core` typed write result DTO | Persists desired values; does not claim hot apply unless true. |
| `/api/factory/providers` CRUD | `@ductum/core` provider DTOs | `@ductum/core` provider DTOs | Typed replacement for provider-shaped config resources. |
| `/api/factory/models` CRUD | `@ductum/core` model DTOs | `@ductum/core` model DTOs | Keeps Ductum model id separate from provider model id. |
| `/api/factory/harnesses` CRUD | `@ductum/core` harness DTOs | `@ductum/core` harness DTOs | Adapter type, command/runtime, supported features, restart behavior. |
| `/api/factory/workflows` CRUD | `@ductum/core` workflow profile DTOs | `@ductum/core` workflow profile DTOs | Saved workflow profiles and validation state. |
| `/api/factory/sandboxes` CRUD | `@ductum/core` sandbox profile DTOs | `@ductum/core` sandbox profile DTOs | Sandbox resource model, not harness-private config. |
| `/api/factory/notification-channels` CRUD | `@ductum/core` notification DTOs | `@ductum/core` notification DTOs | Telegram-specific Settings controls remain deferred. |
| `/api/factory/secrets` CRUD/test | `@ductum/core` secret write/list/test DTOs | `@ductum/core` secret metadata DTOs | Read DTOs never include plaintext or ciphertext. |

## Legacy Endpoint Disposition

| Existing surface | P0 disposition | Owner |
|---|---|---|
| `/api/settings/config` | Remove from normal Settings path. It may exist only as temporary compatibility until P3 removes or isolates it. | P3 |
| `/api/factory-settings` | Keep as read-only compatibility while P1 lands typed `/api/factory/*`; not the final Settings write surface. | P1 |
| `/api/resources/:kind` | Hide from normal UI/API guidance after typed endpoints exist; retain only as debug/compat if still needed. | P3/P6 |
| `/api/telegram/*` | Existing runtime route can remain, but Telegram-specific Settings controls are not part of this pass. | P6 |
| legacy migration helpers/receipt reads | Remove or isolate from normal startup after DB-only init works. | P3 |

## Severity Summary

- Blocker: 7
- Stage-owned: 9
- Cleanup: 2
- Decision-needed: 0

D170 records the runtime settings storage and local secret key-source choices.
Every concrete contradiction below has a stage owner; none need a new
unresolved decision.

## Contradiction Inventory

### 1. `ductum init` still writes `ductum.yaml`

Current fact: `scaffoldFactory` declares `files = ['ductum.yaml', '.gitignore']`,
builds `factoryYaml(...)`, writes `ductum.yaml`, and returns that file in the
scaffold result. Tests assert the YAML file exists and matches
`factoryYaml('factory')`.

Conflicting locked decision: `ductum init` writes directly to SQLite and creates
no `ductum.yaml`.

Affected files:

- `packages/cli/src/init/steps/scaffold.ts:35`
- `packages/cli/src/init/steps/scaffold.ts:47`
- `packages/cli/src/init/steps/scaffold.ts:49`
- `packages/cli/src/init/scaffolders/factory-yaml.ts:11`
- `packages/cli/src/tests/init/scaffold.test.ts:25`
- `packages/cli/src/tests/init/scaffold.test.ts:30`
- `packages/cli/src/tests/init/command.test.ts:85`

Severity: blocker

Owning stage: P2

Recommended resolution: Replace YAML scaffolding with direct SQLite seeding for
Factory, desired runtime settings, Project, Repository/Component, Agents,
assignments, catalog descriptors, workflow, sandbox, and budgets. Update init
output and tests to prove no `ductum.yaml` is created.

Non-goal confirmation: P0 does not change init behavior or schema.

### 2. Startup still treats `ductum.yaml` as normal startup input

Current fact: `ductum start` defaults `--config` to `<dir>/ductum.yaml`, resolves
startup as `legacy-config` when a non-receipt YAML file exists, loads YAML, and
passes repo paths, agents config, worktree config, heartbeat, merge, budget,
public URL, and workflow profiles into the API process through env vars. Repo
scripts also read and seed from `ductum.yaml`.

Conflicting locked decision: Factory Settings are DB-only after init; no
`ductum.yaml`; restart-aware desired runtime config is persisted in DB.

Affected files:

- `packages/cli/src/commands/serve.ts:54`
- `packages/cli/src/commands/serve.ts:73`
- `packages/cli/src/commands/serve.ts:76`
- `packages/cli/src/commands/serve.ts:127`
- `packages/cli/src/commands/serve.ts:139`
- `packages/cli/src/commands/serve.ts:288`
- `packages/cli/src/serve/factory-data.ts:53`
- `packages/cli/src/serve/factory-data.ts:56`
- `packages/cli/src/serve/factory-data.ts:107`
- `packages/cli/src/serve/factory-discovery.ts:48`
- `packages/cli/src/serve/factory-discovery.ts:49`
- `packages/cli/src/serve/config.ts:20`
- `packages/cli/src/serve/config.ts:29`
- `packages/cli/src/serve/api-runtime.ts:87`
- `scripts/serve.mjs:6`
- `scripts/serve.mjs:40`
- `scripts/serve.mjs:63`
- `scripts/serve.mjs:257`
- `scripts/serve-seed.mjs:1`
- `scripts/serve-seed.mjs:15`
- `scripts/serve-seed.mjs:123`
- `scripts/serve-seed-retry.mjs:1`
- `scripts/bootstrap.mjs:35`
- `scripts/bootstrap.mjs:83`
- `scripts/bootstrap.mjs:142`

Severity: blocker

Owning stage: P2/P3

Recommended resolution: Make `ductum start` start from the DB-only Factory
created by init. Stop reading normal runtime settings from YAML; P4 owns current
vs desired runtime values and restart markers. P3 then removes legacy receipt
and YAML compatibility paths from normal startup.

Non-goal confirmation: P0 does not change startup behavior, scripts, or CLI
flags.

### 3. `/api/settings/config` is a YAML file API with DB sync side effects

Current fact: `GET /api/settings/config` returns `{ path, text, config,
warnings }` from the config file. `PUT /api/settings/config` parses YAML,
validates it, syncs Factory, Projects, Agents, Targets, and config resources
into SQLite, writes the YAML file atomically, and returns the redacted YAML
document. Validation still accepts YAML-shaped `targets`, `models`,
`harnesses`, `workflowProfiles`, `sandboxProfiles`, `notificationChannels`, and
`telegram`.

Conflicting locked decision: `/api/settings/config` is not a normal Settings
endpoint; Settings uses typed DB/runtime APIs, not files.

Affected files:

- `packages/api/src/routes/settings.ts:28`
- `packages/api/src/routes/settings.ts:31`
- `packages/api/src/routes/settings.ts:42`
- `packages/api/src/routes/settings.ts:59`
- `packages/api/src/routes/settings.ts:74`
- `packages/api/src/routes/settings.ts:89`
- `packages/api/src/lib/settings-config.ts:19`
- `packages/api/src/lib/settings-target-sync.ts:10`
- `packages/api/src/lib/settings-target-sync.ts:27`
- `packages/cli/src/api-client.ts:148`
- `packages/cli/src/api-client.ts:151`
- `packages/cli/src/api-client.ts:156`
- `packages/api/src/tests/settings.test.ts:16`
- `packages/api/src/tests/settings.test.ts:49`

Severity: blocker

Owning stage: P3

Recommended resolution: Replace normal settings reads/writes with typed
`/api/factory/*` routes from P1. Remove or isolate this endpoint after DB-only
init works. Do not keep file writes as a hidden side effect.

Non-goal confirmation: P0 does not remove or change API routes.

### 4. Dashboard Settings edits parsed YAML and exposes a raw YAML editor

Current fact: `Settings` loads `useEditableSettingsConfig`, renders structured
panels against a parsed `DuctumConfig`, shows `Config file: ... ductum.yaml`,
and includes a `settings-yaml` textarea. Structured controls call
`patchConfigText`, which rewrites YAML text locally before saving back to
`/api/settings/config`. `AgentSettingsManager` uses the same YAML-backed hook.

Conflicting locked decision: Settings UI edits live DB/runtime APIs, not files;
the raw YAML editor is removed; no `ductum.yaml` path in normal Settings.

Affected files:

- `packages/dashboard/src/pages/Settings.tsx:12`
- `packages/dashboard/src/pages/Settings.tsx:118`
- `packages/dashboard/src/pages/Settings.tsx:137`
- `packages/dashboard/src/pages/Settings.tsx:141`
- `packages/dashboard/src/pages/Settings.tsx:146`
- `packages/dashboard/src/settings/useEditableSettingsConfig.ts:3`
- `packages/dashboard/src/settings/useEditableSettingsConfig.ts:34`
- `packages/dashboard/src/settings/useEditableSettingsConfig.ts:55`
- `packages/dashboard/src/settings/yamlPatch.ts:11`
- `packages/dashboard/src/agents/AgentSettingsManager.tsx:5`
- `packages/dashboard/src/tests/settings.test.tsx:52`
- `packages/dashboard/src/tests/yaml-patch.test.ts:7`

Severity: blocker

Owning stage: P6

Recommended resolution: Rebuild Settings on typed API hooks. Remove the raw
YAML textarea and `yamlPatch` dependency from normal UI. Use Project,
Repository, Agent, and typed Factory endpoints for edits.

Non-goal confirmation: P0 does not change dashboard code.

### 5. Secret handling is env-ref/redaction only, not encrypted write-only state

Current fact: settings validation rejects literal secret-looking values and
allows `${ENV_VAR}` references. `resolveEnvValue` expands env refs into agent
spawn config at settings sync time. Telegram config and notification channel
config still carry secret-shaped fields in YAML-shaped config, relying on
redaction for public output. There is no Secret DB schema, no encrypted payload
repo, no `/api/factory/secrets` route, and no key-source implementation.

Conflicting locked decision: Secrets are encrypted local state, write-only,
masked in all reads, and resolved only by authorized runtime paths.

Affected files:

- `packages/api/src/lib/settings-config.ts:98`
- `packages/api/src/lib/settings-config.ts:136`
- `packages/api/src/lib/config-resources.ts:101`
- `packages/api/src/lib/config-resources.ts:107`
- `packages/api/src/routes/settings.ts:278`
- `packages/core/src/legacy-migration-secrets.ts:99`
- `packages/core/src/db-migrations.ts:7`
- `packages/api/src/tests/settings-secret-validation.test.ts:56`
- `packages/dashboard/src/tests/settings-redaction.test.tsx:32`

Severity: blocker

Owning stage: P5

Recommended resolution: Implement the P0 local key-file source, encrypted
Secret metadata/payload storage, write-only secret APIs, secret refs for
provider/harness/agent/notification settings, and runtime-only secret
resolution. Remove env-ref-only placeholders as the normal persisted secret
model.

Non-goal confirmation: P0 does not add schema, crypto code, routes, or
dependencies.

### 6. Typed Factory Settings APIs are not implemented yet

Current fact: `/api/factory-settings` is a single read-only route. It builds a
catalog from current Factory, config resources, agents, and in-memory budget
state. There are no typed write routes such as `/api/factory/settings`,
`/api/factory/runtime`, `/api/factory/models`, `/api/factory/harnesses`, or
`/api/factory/secrets`.

Conflicting locked decision: Settings must use typed DB-backed APIs for
Factory, runtime, providers, models, harnesses, workflows, sandboxes,
notification channels, and secrets.

Affected files:

- `packages/api/src/routes/factory-settings.ts:7`
- `packages/api/src/lib/factory-settings.ts:16`
- `packages/core/src/factory-settings.ts:47`
- `packages/core/src/factory-settings-types.ts:113`
- `packages/cli/src/commands/factory-settings.ts:8`
- `packages/cli/src/types.ts:316`

Severity: stage-owned

Owning stage: P1

Recommended resolution: Add typed DTOs, repos, mappers, and read/write route
contracts. Keep `/api/factory-settings` read-only compatibility only until no
normal consumer depends on it.

Non-goal confirmation: P0 does not add or change API routes.

### 7. Runtime config does not separate desired and current values

Current fact: process runtime settings come from CLI options, env, and YAML
derived env vars. `FactoryConfig` stores only `heartbeatTimeoutSeconds` and
`defaultMergeMode`. `FactorySettingsRuntimePreferences` only exposes those two
fields and has no `current`, `desired`, `applied`, `restartRequired`, or
`affectedRuntimes` shape. API startup logs heartbeat as "from ductum.yaml".

Conflicting locked decision: Settings may edit desired restart-aware runtime
settings, but must show current effective value separately and report restart
requirements.

Affected files:

- `packages/core/src/types.ts:43`
- `packages/core/src/factory-settings-types.ts:108`
- `packages/core/src/factory-settings.ts:213`
- `packages/api/src/index.ts:251`
- `packages/api/src/index.ts:263`
- `packages/api/src/index.ts:368`
- `packages/api/src/index.ts:399`
- `packages/cli/src/serve/config.ts:42`
- `packages/cli/src/serve/api-runtime.ts:96`

Severity: stage-owned

Owning stage: P4

Recommended resolution: P1 adds the dedicated desired runtime settings table.
P4 adds runtime current/desired DTOs and write responses with `applied`,
`restartRequired`, `affectedRuntimes`, `current`, and `desired`.

Non-goal confirmation: P0 does not implement schema changes or runtime API
behavior.

### 8. Project APIs are DB-backed but still carry legacy compatibility fields

Current fact: `/api/projects` creates DB Project rows and Repository/Component
rows, which aligns with the normal operator model. It also falls back to
`workflowPath: 'workflows/coding-guard.yaml'` and writes repository legacy refs
back into `project.repos` for compatibility. The settings sync path can still
create Target rows from YAML-shaped `targets`.

Conflicting locked decision: normal operator model is Project ->
Repository/Component -> Spec -> Task -> Attempt; legacy Target/YAML/resource
mental models must not re-enter normal UI.

Affected files:

- `packages/api/src/routes/projects.ts:180`
- `packages/api/src/routes/projects.ts:187`
- `packages/api/src/routes/projects.ts:213`
- `packages/api/src/routes/projects.ts:254`
- `packages/api/src/lib/settings-target-sync.ts:10`
- `packages/api/src/app.ts:28`
- `packages/api/src/app.ts:70`

Severity: stage-owned

Owning stage: P3/P7

P3 owns removal of Settings/YAML Target sync. P7 owns residual
Project/Repository compatibility field cleanup.

Recommended resolution: Keep DB-backed Project/Repository/Component APIs as the
normal path. Remove Settings/YAML Target sync in P3 and clarify any remaining
legacy fields or debug routes during P7/P9.

Non-goal confirmation: P0 does not change Project, Repository, Component, or
Target routes.

### 9. Agent APIs still accept raw model/harness strings alongside refs

Current fact: `/api/agents` accepts direct `model` and `harness` strings,
`resourceRefs`, and raw `spawnConfig`. It also exposes `/api/models` from the
static catalog. Dashboard Agent Settings still lets operators choose direct
model/harness values or refs.

Conflicting locked decision: Agent config must be clearer, with Agents distinct
from Models and Harnesses and with typed refs for model, harness, sandbox,
workflow permissions, capabilities, budgets, and secret access.

Affected files:

- `packages/api/src/routes/agents.ts:26`
- `packages/api/src/routes/agents.ts:32`
- `packages/api/src/routes/agents.ts:36`
- `packages/api/src/routes/agents.ts:57`
- `packages/api/src/routes/agents.ts:94`
- `packages/dashboard/src/settings/AgentConfigPanel.tsx:66`
- `packages/dashboard/src/settings/AgentConfigPanel.tsx:127`
- `packages/dashboard/src/settings/AgentConfigPanel.tsx:199`
- `packages/dashboard/src/settings/AgentConfigPanel.tsx:215`
- `packages/core/src/types.ts:66`

Severity: stage-owned

Owning stage: P7

Recommended resolution: Normalize Agent DTOs around typed refs and explicit
runtime identity. Preserve legacy readable columns only as compatibility until
dispatch and snapshots are migrated.

Non-goal confirmation: P0 does not change Agent APIs, validation, or dashboard
controls.

### 10. Generic config resource routes remain public normal-looking CRUD

Current fact: `/api/resources/:kind` exposes generic CRUD for
`WorkflowProfile`, `Model`, `Harness`, `SandboxProfile`, and
`NotificationChannel`. Dashboard client code still calls
`/resources/NotificationChannel`, and Settings renders "Factory catalogs" from
YAML-shaped sections.

Conflicting locked decision: Factory Settings replaces generic resource
management in normal operation; legacy resource mental models must not re-enter
normal UI.

Affected files:

- `packages/api/src/routes/config-resources.ts:10`
- `packages/api/src/lib/config-resources.ts:10`
- `packages/dashboard/src/api/client.ts:465`
- `packages/dashboard/src/settings/ConfigResourcesPanel.tsx:17`
- `packages/dashboard/src/settings/ConfigResourcesPanel.tsx:55`
- `packages/api/src/tests/config-resources.test.ts:12`

Severity: stage-owned

Owning stage: P3

Recommended resolution: Typed `/api/factory/*` endpoints become the normal
surface. Hide or isolate generic resource routes as debug/compat after the
typed API and dashboard rebuild exist.

Non-goal confirmation: P0 does not remove resource routes.

### 11. Telegram is active in Settings and API despite being deferred here

Current fact: API registers `/api/telegram/status`, `/api/telegram/chats`,
`/api/telegram/test-send`, and `/api/telegram/webhook`. Settings renders a full
Telegram approvals panel, including legacy YAML controls. Config-resource
validation only accepts `NotificationChannel.backend = telegram`.

Conflicting locked decision: Telegram is deferred for this source-of-truth
redesign; do not build Telegram-specific settings in this pass.

Affected files:

- `packages/api/src/app.ts:29`
- `packages/api/src/routes/telegram.ts:16`
- `packages/api/src/routes/telegram.ts:29`
- `packages/api/src/routes/telegram.ts:34`
- `packages/api/src/routes/telegram.ts:61`
- `packages/api/src/routes/telegram.ts:89`
- `packages/api/src/lib/config-resources.ts:61`
- `packages/dashboard/src/pages/Settings.tsx:119`
- `packages/dashboard/src/settings/TelegramSettingsPanel.tsx:84`
- `packages/dashboard/src/settings/TelegramSettingsPanel.tsx:170`
- `packages/dashboard/src/tests/settings.test.tsx:20`

Severity: stage-owned

Owning stage: P6

Recommended resolution: Keep existing Telegram runtime behavior only if needed
for compatibility, but remove Telegram-specific Settings controls from this
arc's normal UI. Future Telegram settings need their own stage and secret refs.

Non-goal confirmation: P0 does not remove Telegram routes or UI.

### 12. Legacy migration/read/receipt paths remain active

Current fact: core has migration planning and apply functions for legacy
`ductum.yaml`; serve startup reads a legacy migration receipt; tests assert
migration and secret validation behavior. The migration path remaps old Targets
to Repositories/Components and preserves legacy Attempts.

Conflicting locked decision: no legacy migration path is needed for this
redesign; start fresh.

Affected files:

- `packages/core/src/legacy-migration.ts:29`
- `packages/core/src/legacy-migration-read.ts:1`
- `packages/core/src/legacy-migration-repositories.ts:1`
- `packages/core/src/legacy-migration-validate.ts:54`
- `packages/core/src/legacy-migration-types.ts:35`
- `packages/core/src/legacy-migration-summary.ts:15`
- `packages/api/src/lib/legacy-config-preflight.ts:14`
- `packages/cli/src/serve/legacy-receipt.ts:11`
- `packages/cli/src/serve/factory-data.ts:54`
- `scripts/serve-seed.mjs:6`
- `scripts/serve-seed-retry.mjs:1`
- `packages/core/src/tests/legacy-migration.test.ts:5`
- `packages/core/src/tests/legacy-migration-secrets.test.ts:9`

Severity: stage-owned

Owning stage: P3

Recommended resolution: After P2 proves DB-only init/start, remove or isolate
legacy migration code so it is not part of normal startup, Settings, or docs.
Keep historical Attempt display only if still required by existing DB fixtures.

Non-goal confirmation: P0 does not delete migration code or tests.

### 13. Model catalog is static and not seeded as typed DB state yet

Current fact: the API model catalog derives from `@ductum/core`'s static
`MODEL_REGISTRY`, which is good for parity. Factory Settings models, however,
come only from saved `Model` config resources. The registry has `sourceUrl` but
no `lastVerified` field, and there is no catalog refresh workflow or DB seed
path for newly available models in init.

Conflicting locked decision: model catalog refresh must handle newly available
models and init must seed or expose the current catalog through DB/API without a
YAML edit.

Affected files:

- `packages/core/src/model-registry.ts:41`
- `packages/core/src/model-registry-data.ts:39`
- `packages/api/src/lib/model-catalog-data.ts:17`
- `packages/api/src/lib/model-catalog.ts:24`
- `packages/core/src/factory-settings.ts:48`
- `packages/core/src/factory-settings.ts:150`
- `packages/dashboard/src/settings/ConfigResourcesPanel.tsx:132`
- `specs/current/post-p9-hardening/factory-settings-source-of-truth/P8-MODEL-CATALOG-REFRESH-PATH.md:7`

Severity: stage-owned

Owning stage: P8

Recommended resolution: P8 verifies provider catalogs from official sources,
adds missing `lastVerified` metadata, refreshes entries, and ensures P2/P1
seeded DB descriptors or typed APIs expose the refreshed catalog.

Non-goal confirmation: P0 does not browse provider docs, change model IDs,
change pricing, or add dependencies.

### 14. Checked-in YAML files still behave as live factory config

Current fact: root `ductum.yaml`, `ductum.example.yaml`, and
`ductum.docker.yaml` still define factory, agents, projects, models, harnesses,
sandbox profiles, notification channels, Telegram, ports, and dashboard port.
Root `ductum.yaml` comments also mention `ductum resource list Model` and
`ductum config apply`, but no matching CLI commands are registered.

Conflicting locked decision: no `ductum.yaml`; no YAML editor; no legacy
YAML/resource mental model in normal operation.

Affected files:

- `ductum.yaml:5`
- `ductum.yaml:21`
- `ductum.yaml:77`
- `ductum.yaml:94`
- `ductum.yaml:164`
- `ductum.example.yaml:15`
- `ductum.example.yaml:22`
- `ductum.example.yaml:52`
- `ductum.docker.yaml:14`
- `ductum.docker.yaml:35`
- `packages/cli/src/program.ts:35`
- `packages/cli/src/program.ts:44`

Severity: cleanup

Owning stage: P3

Recommended resolution: After DB-only init/start passes, remove these files
from normal docs and runtime paths or reclassify any remaining YAML as
historical fixtures/snapshots only. Fix stale command comments during docs/code
cleanup.

Non-goal confirmation: P0 does not delete YAML files or edit CLI commands.

### 15. Active docs and tests still teach YAML authority

Current fact: active docs still instruct operators to configure, paste entries
into, mount, or back up `ductum.yaml`. Non-Settings UI copy and source comments
also describe normal agent/runtime behavior as configured from `ductum.yaml`.
Tests assert the active YAML Settings API, dashboard raw YAML UI, YAML patch
helper, and bundled onboarding config.

Conflicting locked decision: DB-only after init; no YAML editor; no legacy YAML
authority in normal operation.

Affected files:

- `README.md:14`
- `README.md:72`
- `docs/SETUP.md:103`
- `docs/SETUP.md:111`
- `docs/SETUP.md:197`
- `docs/SETUP.md:230`
- `docs/SELF_HOST_MAC_MINI.md:56`
- `docs/DOCKER.md:31`
- `docs/DOCKER.md:57`
- `packages/dashboard/src/agents/AgentWorkforce.tsx:167`
- `packages/harness/src/claude.ts:12`
- `packages/harness/src/opencode.ts:24`
- `packages/harness/src/copilot-sdk.ts:39`
- `packages/harness/src/copilot-sdk.ts:51`
- `packages/harness/src/copilot-sdk.ts:164`
- `packages/harness/src/codex-app-server-types.ts:58`
- `packages/api/src/index.ts:251`
- `packages/api/src/index.ts:264`
- `packages/api/src/index.ts:368`
- `packages/api/src/index.ts:399`
- `packages/api/src/routes/factory.ts:73`
- `packages/api/src/validate-env.ts:5`
- `packages/api/src/lib/deps.ts:140`
- `packages/core/src/model-pricing.ts:15`
- `packages/cli/src/output.ts:71`
- `packages/cli/src/init/steps/welcome.ts:13`
- `scripts/onboarding-config.test.mjs:7`
- `packages/api/src/tests/settings.test.ts:16`
- `packages/dashboard/src/tests/settings.test.tsx:52`
- `packages/dashboard/src/tests/yaml-patch.test.ts:7`

Severity: cleanup

Owning stage: P3

Recommended resolution: Update active docs and tests as each implementation
stage removes the corresponding YAML behavior. Historical specs can stay
historical, but normal onboarding/setup docs must teach DB-only state by P9.

Non-goal confirmation: P0 does not rewrite docs/tests beyond this planning
audit.

### 16. Init already-initialized guard is keyed on `ductum.yaml`

Current fact: `validateWritableDirectory` rejects an init target only when
`<path>/ductum.yaml` exists, and `alreadyInitialized` says the path already
contains `ductum.yaml`.

Conflicting locked decision: `ductum init` writes directly to SQLite and
creates no `ductum.yaml`; an initialized Factory is DB state, not YAML state.

Affected files:

- `packages/cli/src/init/paths.ts:76`
- `packages/cli/src/init/paths.ts:99`
- `packages/cli/src/init/paths.ts:112`
- `packages/cli/src/tests/init/paths.test.ts:42`

Severity: blocker

Owning stage: P2

Recommended resolution: Change init idempotency to detect initialized DB
Factory state, not `ductum.yaml`. Re-init against a populated DB-only Factory
must be rejected before seeding or committing anything, with copy that describes
an existing Factory rather than an existing YAML file.

Non-goal confirmation: P0 does not change init validation behavior.

### 17. Init handoff keeps Settings pointed at YAML and seeds only partial DB

Current fact: the post-scaffold init API process uses
`configPath: join(input.projectDir, 'ductum.yaml')`. The browser handoff then
calls `seedWelcomeFactory`, which seeds the API with Factory, Project, Agents,
and Project Agent assignments only. Providers, models, harnesses, workflows,
sandbox profiles, budget defaults, desired runtime settings, and secret
key-source setup are not seeded there.

Conflicting locked decision: `ductum init` writes directly to SQLite, creates a
complete DB-only Factory, and does not use YAML as the Settings source at t=0.

Affected files:

- `packages/cli/src/init/steps/api-process.ts:88`
- `packages/cli/src/init/steps/api-process.ts:100`
- `packages/cli/src/init/steps/browser-handoff.ts:78`
- `packages/cli/src/init/steps/browser-handoff.ts:90`
- `packages/cli/src/init/steps/welcome-seed.ts:22`
- `packages/cli/src/init/steps/welcome-seed.ts:27`
- `packages/cli/src/init/steps/welcome-seed.ts:31`
- `packages/cli/src/init/steps/welcome-seed.ts:38`
- `packages/cli/src/tests/init/browser-handoff.test.ts:179`

Severity: blocker

Owning stage: P2

Recommended resolution: P2 must use a core DB seeder invoked by init before the
API handoff starts. The handoff API may serve the dashboard, but it must not be
the source of Factory seeding and must not expose `/api/settings/config` as a
fresh-init dependency. The seeder must create the full initial Factory state
listed in the P2 acceptance criteria.

Non-goal confirmation: P0 does not change API process startup, handoff, or seed
behavior.

### 18. Init commit posture would include DB authority unless explicitly blocked

Current fact: the factory `.gitignore` generated by init ignores `.ductum/`,
which would cover `<factoryDir>/.ductum/secrets.key`, but it does not ignore
`ductum.db`. The current init scaffold stages generated source files for the
initial commit. P2 changes the generated authority from YAML to SQLite, so the
same commit posture would risk committing the Factory DB by default.

Conflicting locked decision: Factory Settings are DB-only after init, and
secrets are encrypted local state with a key stored outside SQLite. The DB may
eventually contain secret ciphertext and other local operational state; it must
not be treated as normal git-tracked source.

Affected files:

- `packages/cli/src/init/scaffolders/factory-yaml.ts:31`
- `packages/cli/src/init/scaffolders/git-init.ts:16`
- `packages/cli/src/init/steps/scaffold.ts:35`
- `packages/cli/src/init/steps/scaffold.ts:49`
- `packages/cli/src/tests/init/scaffold.test.ts:34`
- `packages/cli/src/init/steps/api-process.ts:88`

Severity: stage-owned

Owning stage: P2/P5

Recommended resolution: P2 updates init `.gitignore` and initial commit
behavior so `ductum.db` and `.ductum/secrets.key` are never committed by
default. P5 keeps the key under `.ductum/` and verifies secret ciphertext/key
material are not staged by init.

Non-goal confirmation: P0 does not change gitignore, init commits, or secret
storage.

## P0 Reconciliation Sweep

P0 reconciliation command:

```bash
rg -n "settings/config|yamlPatch|settings-yaml|ductum\\.yaml|loadServeConfig|seedFromConfig" packages/api packages/cli packages/core packages/dashboard/src packages/harness/src scripts docs README.md ductum*.yaml specs/current/post-p9-hardening/factory-settings-source-of-truth -g '!packages/dashboard/dist/**'
```

Disposition:

- Init YAML creation, init guards, init handoff config path, and init tests are
  covered by items 1, 16, and 17.
- Startup config, factory discovery, bootstrap, and serve seed paths are
  covered by item 2.
- `/api/settings/config`, CLI Settings config helpers, Settings YAML editor,
  dashboard YAML fixtures, and YAML patch helpers are covered by items 3 and 4.
- Generic config resources and Target sync through YAML are covered by items
  8, 10, and 12.
- Legacy migration, legacy preflight, and YAML-to-DB seed helpers are covered
  by item 12.
- Checked-in YAML files, active docs/tests, non-Settings UI labels, and source
  comments that teach YAML authority are covered by items 14 and 15.
- Historical analysis docs and older closed specs are not implementation
  blockers; normal setup/operator docs are covered as cleanup.

## Audited Non-Contradictions

- `/api/projects` and Repository/Component routes are already DB-backed for the
  normal operator model. The contradiction is limited to compatibility fields
  and YAML/Target sync, not to the existence of these APIs.
- `/api/agents` is DB-backed and redacts public `spawnConfig`. The
  contradiction is the mixed raw/ref shape and missing typed secret refs.
- The core model registry is already the single source for API catalog/pricing
  parity. The remaining contradiction is refresh/last-verified/DB seeding, not
  duplicate pricing tables.
- Public redaction coverage exists across API/dashboard/CLI tests. The
  contradiction is storage semantics: redaction is not encrypted write-only
  secret state.
