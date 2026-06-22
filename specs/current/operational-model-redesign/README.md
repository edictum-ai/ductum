# Ductum Operational Model Redesign

## Status

Closed after P9 PASS.

P1-P9 are complete. P9 passed on 2026-06-09 after the final review/demo gate
and the P9 delta blocker fixes in `15ab5e4` (`fix: close p9 operator
blockers`). The operational model redesign is now accepted as the normal
Ductum operator model.

Remaining polish is tracked in
`specs/current/post-p9-hardening/README.md`. Those items are post-P9
hardening, not blockers to this arc. Ductum may now dogfood later polish
stages.

## Why This Exists

Ductum's current operational model is hard to reason about because the same
surfaces carry too many meanings at once.

`ductum.yaml` does too many jobs. It is human configuration, resource catalog,
project wiring, startup input, seed input, and runtime-adjacent settings in one
file. That makes it difficult to tell which values are operator intent, which
values are declarative resources, and which values are only there because a
startup script needs them today.

Onboarding and startup also mix concerns that should be separate: human setup,
seed data, resource declarations, runtime state, project wiring, dashboard
defaults, and dispatcher inputs. A new operator can run setup successfully and
still hit errors only after the API has already started and partial seed work
has already run.

Resource references can fail too late. Agents can reference models, harnesses,
workflow profiles, sandbox profiles, or other resources that are missing,
ambiguous, malformed, or scoped differently than expected. Some failures appear
only during seed, dispatch, or runtime resolution instead of before startup.

Names drift across the system. A model alias, provider model ID, resource name,
agent name, harness type, dashboard label, registry key, and runtime adapter key
can look similar while meaning different things. When those names drift between
config, registry, dashboard, runtime, and seed code, the operator gets errors
that are technically true but not actionable.

Fixing one area often creates inconsistent behavior elsewhere. A change that
makes the dashboard truthful may not match the API. A CLI fix may not match the
runtime. A seed change may make local startup work while leaving dashboard
pickers or dispatcher resolution stale. The redesign exists to give those
surfaces one shared operational contract.

## One-Sentence Product

Ductum is a local-first factory control plane for safely dispatching, reviewing, and operating AI coding agents across projects.

## Locked Goals

- Make startup predictable.
- Make onboarding simple.
- Make config understandable.
- Separate human config from runtime state.
- Separate resource declarations from job/run state.
- Validate before mutation.
- Make errors point to exact config keys.
- Make dashboard, API, and CLI consume the same contracts.
- Keep supply-chain rules intact.
- Keep harness enforcement structural, not advisory.

## Non-Goals

This redesign does not implement:

- New agent harnesses.
- New AI providers.
- New workflow enforcement semantics.
- A new marketplace.
- A cloud service.
- Replacing the Edictum workflow runtime.
- Rewriting the whole dashboard.
- Changing historical run records.
- Removing existing compatibility without migration.

## Operator Feedback

Multiple agents and operator runs found Ductum painfully difficult to use.

The issue is not only UI polish. The core problem is that Ductum exposes too
much of its internal factory model during setup and daily operation. A new
operator has to understand resources, agents, models, harnesses, workflow
profiles, targets, specs, tasks, runs, approvals, config files, seed behavior,
and dispatcher state before they can reliably start work.

The redesign must make the normal path boring:

1. install Ductum
2. run setup
3. connect providers
4. add or detect a project
5. choose agents
6. start the factory
7. import/create work
8. review/approve results

Advanced concepts can remain available, but they must not be required for the
first successful loop.

## Current Concrete Failure

The current observed failure is:

```text
Agent codex modelRef not found: gpt-5-4
```

This is not just one missing model reference. It is a symptom of the larger
startup and configuration problem.

Agent resource references are validated after partial startup and seed work has
already begun. The API can be running, the factory row can be written, and agent
seed work can start before the full resource graph has been proven valid.

Resources are seeded after agents, so an agent can reference a model that exists
later in the same config file but is not yet present at the moment the agent is
created or validated.

Aliases, resource IDs, and provider model IDs are not clearly separated. In this
case, `gpt-5-4` is an agent-facing resource reference, while `gpt-5.4` is the
provider model ID. Those names are close enough to invite confusion, but they
are not interchangeable.

Ductum does not yet have a single preflight validation phase that loads the
config, resolves references, checks ordering, validates scope, and reports exact
config keys before mutating runtime state.

## Acceptance For Part 1

This part is accepted only when:

- It describes the problem accurately.
- It does not propose implementation details yet.
- It does not expand scope.
- It gives us a clear base for Part 2: primitives and state boundaries.

## Part 2: Primitives And State Boundaries

This redesign separates the operator model from the internal runtime model.
Ductum may keep existing internal names during migration, but the normal
operator path must use the smaller product model below.

## Operator Model

The normal operator sees Ductum in this order:

1. Finish setup if setup is incomplete.
2. See projects and their status.
3. Drill into a project.
4. Monitor factory activity and attempts.
5. Review, approve, or fix anything that needs attention.

The daily top-level unit is the **Project**. A project is a product or system
boundary. It can contain one repository or many repositories.

The home view optimizes for monitoring and visualization. It should show what
is running, what changed, what is blocked, what needs attention, and where to
click next. It should not expose the whole internal factory graph.

## Operator Primitives

**Factory** is the Ductum installation/control plane. It owns global settings,
providers, agents, harnesses, workflows, notification settings, and runtime
health.

**Project** is the product or system being operated. Examples: `Ductum`,
`Qratum`, `Edictum`. Projects are the main daily navigation unit.

**Repository** is where source code or docs live. A repository may be a local
path on a laptop or a remote Git repository used by a deployed factory. This is
a required boundary for work.

**Component** is an optional work scope inside one Repository, such as an app,
package, service, docs area, schema area, or other useful repository slice.
Components are helpful for routing, filtering, ownership, and visualization, but
they are not required for onboarding.

**Spec** is the operator's work request or design intent. It may target one or
more repositories and may optionally narrow repository work to components.

**Task** is a concrete unit of work created from a Spec. A Task must target a
repository and may target a component.

**Attempt** is one execution try for a Task by an agent. This is the
operator-facing word for the current internal Run concept.

**Review** is a work phase or check, not a separate top-level place to manage by
default. Reviewer work appears as Attempts. Review output is evidence or a
verdict attached to the Task or Attempt. Approval remains the operator decision.

**Agent** is a named worker configured from a role/system prompt, harness,
compatible provider, model, and operator-chosen name. Agents are configured at
the factory level and assigned to projects.

**Harness** remains an operator-facing word. Operators choose from supported
harnesses when creating or editing agents.

**Workflow** is the operator-facing word for the current workflow profile idea.
Projects choose one Workflow record from Factory Settings. A Workflow record can
come from a built-in preset, an imported repository file, or a custom edit, but
after selection the Factory Settings record is the authority.

## WorkPackage And SpecIntake

**WorkPackage** or **SpecIntake** is the public input contract for generated
work. Qratum and other generators should target this contract, not legacy task
YAML.

The contract follows the operator model:

```text
Project
  Repository
    optional Component
      Spec
        Task
```

A WorkPackage names the Project, the target Repository or Repositories, any
optional Repository-local Components, and the Spec to create. Ductum resolves
that package into Repository-scoped Tasks through the same runtime path used by
UI and CLI Spec intake.

Attempts are runtime records created by Ductum when a Task starts. They are not
part of the generator input contract.

During migration, Ductum may provide a compatibility adapter from
WorkPackage/SpecIntake into the current legacy spec import shape. That adapter
is a bridge, not the recommended external contract.

## Edictum And Qratum Shape

The model must support both multi-repo systems and single-repo projects without
forcing either one into the wrong shape.

For Edictum:

```text
Project: Edictum
Repositories:
  edictum
  edictum-go
  edictum-ts
  edictum-api
  edictum-app
  edictum-docs
  edictum-hub
  edictum-harness
  edictum-schemas
  edictum-demo
  edictum-openclaw
Components:
  optional repository-local scopes such as packages, apps, services, docs areas
```

For Qratum:

```text
Project: Qratum
Repositories:
  qratum
Components:
  optional labels such as specs, app, cli, schemas, importer
```

A simple project can start with one repository and no explicit components.
Ductum should not block onboarding because the operator has not fully mapped
components yet.

## Internal-Only Concepts

Normal UI and CLI must not use **resource** as a generic word. Use concrete
words: Project, Repository, Component, Agent, Model, Harness, Workflow,
Notification.

Normal UI and CLI must not expose **seed** as an operator concept. Startup and
setup should say "validating configuration" and "applying configuration" when a
human-facing phase label is needed.

The current internal **Target** concept maps roughly to repository/component
scope. The operator model should move to Repository as the required boundary and
Component as the optional narrower boundary.

Runtime workspace, worktree, sandbox, dispatcher, queue, and worker are runtime
or advanced concepts. Normal views may summarize them as Factory Activity,
Attempts, health, or execution location. Debug and advanced views can expose
the deeper terms when needed.

## Factory Settings

Factory Settings replaces the generic resource surface in normal operation.

Factory Settings owns:

- Agents.
- Models.
- Harnesses.
- Providers and credentials.
- Workflows.
- Sandbox profiles.
- Notification channels.
- Factory budgets and runtime preferences.

Projects do not define new global agents, models, or harnesses inline during
normal onboarding. Projects choose from factory-level items and can override
project-specific assignments or workflow choices.

## Config And Runtime State

After bootstrap, the database plus UI/CLI are the source of truth. YAML or TOML
is for bootstrap, import, export, and receipt-style metadata only.

The bootstrap file should be a minimal receipt or pointer. It should not be the
daily definition of projects, specs, agents, models, harnesses, workflows,
targets, or runtime state.

Project onboarding and Spec creation happen through the app or CLI, not by
editing the main config file.

Invalid live config edits are rejected before save. Normal UI/CLI must not save
partial invalid state and then require the operator to discover the problem at
startup or dispatch time.

All Ductum-owned objects have stable internal IDs. Names are editable labels or
slugs. External provider model IDs and harness adapter keys are separate from
Ductum identity.

New Attempts keep runtime snapshots of the model, harness, workflow, and
execution context they use so records remain understandable after config
changes. Legacy Runs may be presented as Attempts in the redesigned UI, but they
only have the historical fields that were actually captured. The migration must
not pretend old Runs have full Attempt snapshots.

Runtime state does not belong in human config. Attempts, approvals, events,
health, queue state, costs, worktrees, session bindings, evidence, and logs are
runtime or audit state.

## Setup And Onboarding

First-time setup creates or opens a Factory.

Project onboarding starts from a repository or path. If the operator is inside a
Git repository, Ductum should offer that repository first. Otherwise it asks for
a local path or remote repository and infers a project name for confirmation.

During project onboarding, the operator chooses project agents from factory-level
agents. Assignments can be changed later from project settings. If no suitable
agent exists, onboarding links to the main agent setup path instead of asking the
operator to hand-edit config.

Ductum should detect and confirm repository details, likely project name,
available project areas, available workflows, available agents, and missing auth
or provider problems. It should not silently create hidden complexity.

If no workflow exists for a project, Ductum offers built-in workflow presets and
requires the operator to choose one. A project is ready only after its selected
workflow validates.

Workflow edits happen from project settings. Invalid workflow edits are rejected
before save. Active Attempts keep the workflow snapshot they started with. New
work uses the updated workflow. For queued but not-started work, Ductum asks
whether to keep the old workflow or apply the new one.

Project onboarding is complete when the project has at least one repository, a
valid workflow, valid agent assignments, and can accept Specs.

## Factory Lifecycle

`ductum start` starts or opens the local Ductum app/control plane. If Ductum is
already running, it connects to the existing UI.

Starting Ductum does not mean "start dispatching work." Dispatch and worker
activity are driven by project and Spec lifecycle: projects must be ready, Specs
must exist, and Tasks must be eligible for Attempts.

Setup should ask whether to run Ductum in the background, install it as a
service/startup item, or keep it manual. Background operation must be explicit.

A Factory with no projects is valid. The app opens normally and prompts the
operator to add a project.

If one project has invalid config, Ductum isolates that project, shows exact
errors, and keeps valid projects usable. A broken project should not take down
the whole Factory.

Stopping Ductum is an operator choice: drain active Attempts, cancel active
Attempts, or force stop and mark affected Attempts interrupted.

## Migration Boundary

Existing `ductum.yaml` is imported once during migration.

Old project repo entries and old `targets` are both migration inputs.
`projects.*.repos` contributes the repository list. `targets` contributes
source scope, branch defaults, workflow references, and task targeting. Migration
deduplicates the two sources before writing redesigned Repository records.

Components are created only when an old target clearly maps to a sub-area. If
the mapping is uncertain, Ductum keeps the Repository and leaves Component
blank.

Old models, harnesses, workflow profiles, sandbox profiles, notification
channels, and agents migrate into Factory Settings. Existing project-agent
assignments are recreated from the old project agent mapping.

Existing Tasks that point at old target IDs must be remapped to Repository plus
optional Component scope. Existing Runs are displayed as legacy Attempts with
partial historical snapshots; the migration does not backfill data that was
never captured.

Because Ductum is currently operated by one user, this redesign can use a
big-bang migration instead of a long dual-mode compatibility period. Migration
validates before writing. Broken references stop migration with exact errors.

After migration, `ductum.yaml` no longer affects startup except as a minimal
receipt or pointer.

## Acceptance For Part 2

This part is accepted only when:

- It gives operators a smaller model than the current resource graph.
- It supports both single-repo and multi-repo projects.
- It separates repositories from optional components.
- It separates bootstrap config from runtime state.
- It keeps stable Ductum IDs separate from editable names and external keys.
- It does not add implementation prompts.

## Part 3: Contracts And Storage Shape

Part 3 defines durable boundaries for the redesigned model. It does not define
tables, endpoints, migrations, or implementation prompts.

## Factory Storage

Each Factory has one durable data directory. By default, that directory lives
under a user-global Ductum root such as `~/.ductum`, but the meaningful boundary
is the Factory data directory, not the parent path.

The Factory data directory owns:

- the authoritative database;
- app auth and handoff state;
- logs and event exports;
- artifact files;
- backup/export bundles;
- runtime metadata that must survive process restarts.

The database is authoritative for Ductum app and control-plane state. Files hold
artifacts, logs, backups, large evidence payloads, and generated exports.

Worktrees, sandboxes, temporary checkouts, live process state, and active
session sockets are runtime execution state. They are not durable product
identity and are not required to be portable.

## Host Portability

A Project can exist on multiple Factory hosts. The same product can be known to
a laptop Factory, a Mac mini Factory, a Linux VM Factory, or a future AWS
Factory.

Project identity is not tied to one local path or one machine. Repository remote
identity is portable. Ductum stable IDs are portable when moving a Factory by
backup/export/import. Independently created Factory hosts may know about the
same real-world Project through the same repositories while still having their
own local Ductum IDs.

Within one Factory, concurrent work is coordinated at the active Spec, Task,
Repository, branch, and Attempt level. Ductum should not block a whole Project
from being known by multiple Factory hosts. This design does not introduce a
cloud coordination service or shared lock manager. Cross-host safety is limited
to explicit export/import, remote Git state, branch discipline, and future
coordination decisions. Do not claim transparent multi-host locking from this
spec alone.

Backup and export should include everything needed to restore the Factory's
memory except ephemeral worktrees, sandboxes, and live process state.

## Record Classes

Ductum records fall into four classes. The class defines editability,
validation, and how the operator should reason about the record.

**Config records** are durable settings and product structure. They include
Factory Settings, Projects, Repositories, Components, Agents, Providers, Models,
Harnesses, Workflows, sandbox profiles, notification channels, budgets, and
project assignments.

**Work records** are durable units of intended work. They include Specs and
Tasks.

**Runtime records** are live execution state. Attempts are runtime records while
active. Queue state, health state, session bindings, heartbeats, and execution
locations are runtime records.

**Audit records** are trust and history records. They include approvals,
evidence, decisions, events, verdicts, and terminal Attempt history. Evidence
and decisions are append-oriented. Events are append-only or log-like. Pending
approvals may change state, but their lifecycle remains audit-important.

Terminal Attempts remain durable history. Runtime does not mean disposable.

## Repository And Component Contract

Repositories are remote-first. A Repository should prefer a remote Git URL as
portable identity and may also have a local checkout path for the current
Factory host.

Local-only repositories are allowed, but they are marked local-only and
non-portable. They are not ready for remote merge or pull-request workflows
until remote, auth, fetch, branch, and push readiness pass.

Ductum should check Git readiness during project onboarding:

- repository exists;
- Git is initialized;
- remote is configured when remote workflows are desired;
- GitHub or Git credentials are available;
- remote fetch works;
- branch creation works locally;
- push readiness is known before remote merge or pull-request workflows run.

Components are optional. Ductum may suggest Components during onboarding from
repository structure and may infer Components later from changed paths and Spec
history. The operator confirms Components before they become durable structure.

A Task must target a Repository. A Task may optionally target a Component. A
Task should not be allowed to start if its target Repository or Component is not
ready.

Branch rules use this hierarchy:

1. Project defaults.
2. Repository overrides.
3. Spec or Task override only when explicitly needed.

Workflows govern process and gates. They do not own Git topology.

Workflow records are the runtime authority. Built-in presets and repository
workflow files are sources for creating or updating Workflow records; they are
not competing authorities after import.

The first implementation of this redesign cannot complete onboarding without at
least one built-in, validated Workflow preset. Presets are a blocking design
dependency, not optional polish.

Custom or imported Workflows must map onto Ductum's public Attempt lifecycle
model. Workflow-specific phases, checks, reviews, and gates can be represented
as evidence, checks, verdicts, or substeps without requiring this design to
define new public Attempt stages. A later implementation decision must pin the
exact lifecycle vocabulary before custom workflows ship.

## Agent, Provider, Model, And Harness Contract

**Provider** means auth and model vendor. Examples: OpenAI, Anthropic, GitHub
Copilot, Z.AI, and OpenRouter.

**Model** is a Ductum record wrapping provider, provider model ID, capabilities,
and supported options. The Ductum Model ID is separate from the provider model
ID.

**Harness** is the runner adapter that drives an agent runtime. Examples include
Pi, Claude Agent SDK, Codex SDK, Copilot SDK, and future adapters. Harnesses
declare compatibility with providers, models, execution modes, or sandbox modes
as needed.

**Agent** is a composed worker:

- operator name;
- role or system prompt;
- Harness;
- Provider;
- Model;
- effort/settings;
- budget/cost metadata;
- optional sandbox/workflow defaults.

Agent compatibility validates before save. Ductum should not save enabled Agent
configuration when the harness, provider, model, effort, auth, or required
settings are incompatible.

## Attempt Snapshot Contract

An Attempt snapshots full runtime context before it starts.

The snapshot includes:

- Spec and Task identity;
- Project, Repository, and optional Component;
- Agent identity and display name;
- role and system prompt identity/content reference;
- Provider;
- Model and provider model ID;
- Harness and adapter key;
- Workflow;
- sandbox profile;
- branch rules and selected branch;
- budget and caps;
- execution host identity;
- checkout/worktree path;
- sandbox ID when present;
- non-secret readiness metadata for auth/provider/git state.

Active Attempts are never affected by later config changes.

Queued Tasks use the latest valid config when they start. Ductum does not need
to snapshot runtime config for every queued Task before an Attempt exists.
Workflow changes are the exception: when a Workflow edit affects queued but
not-started work, Ductum asks whether that queued work should keep the old
Workflow or use the new one.

After an Attempt starts, all start fields are immutable. Only execution state
changes: status, stage, heartbeat, cost, evidence, logs, events, approval state,
and outcome.

Agent rotation, runtime recovery, fix work, and review work never mutate the
Agent or runtime identity of an already-started Attempt. They end or supersede
one Attempt and create another Attempt with a new snapshot.

## Validation Contract

Config records use strict save. Invalid config records cannot be saved as normal
enabled records.

Projects must be ready to save in normal onboarding and project settings. A
ready Project has at least one valid Repository, valid workflow selection, valid
agent assignments, and can accept Specs.

If a running Factory detects a broken Project, it disables dispatch for that
Project, keeps the Project visible, and shows exact errors. Valid Projects
continue working.

Specs can exist while their target Repository or Component is not ready, but
they cannot start Attempts until the target is ready.

Errors point to field paths and human labels. After the redesign, errors should
not rely on old YAML keys as the primary explanation. A good error identifies:

- the record;
- the field path;
- the human label;
- the invalid value or missing dependency;
- the suggested fix.

## Public Contract Names

API, UI, CLI, JSON, and error responses use the operator model names:

- Factory
- Project
- Repository
- Component
- Spec
- Task
- Attempt
- Agent
- Provider
- Model
- Harness
- Workflow
- Approval
- Evidence
- Decision
- Factory Activity

The redesign is a hard cutover for the new public contract naming. Old words
such as Run and Target should not remain as documented public CLI or JSON names
in the new contract.

Internal code may migrate in slices, and legacy compatibility routes or commands
may exist behind explicit migration/debug surfaces while the cutover lands. The
normal documented UI, CLI, API, JSON, and errors must not expose the old mental
model once the redesigned public contract is active.

The Run-to-Attempt and Target-to-Repository/Component cutovers are broad public
contract changes, not cosmetic copy edits. They may require staged facade work
over existing internals. The dashboard non-goal means "do not replace the whole
dashboard product," not "leave every current run surface untouched."

Normal UI never shows raw internal enum values as the primary label. Debug and
advanced views may expose raw values as secondary metadata.

The default CLI/status view is combined: project summary, factory activity, and
next actions.

## Acceptance For Part 3

This part is accepted only when:

- It defines the durable storage boundary without implementation details.
- It treats laptop, Mac mini, Linux VM, and AWS VM as the same Factory model.
- It makes local paths deployment-specific, not identity.
- It defines config, work, runtime, and audit record classes.
- It defines Repository as required and Component as optional.
- It treats built-in Workflow presets as a blocking prerequisite for first
  onboarding.
- It defines Provider, Model, Harness, and Agent without name drift.
- It defines what an Attempt snapshots and what becomes immutable.
- It defines validation before mutation.
- It makes public API, UI, CLI, JSON, and error names match the operator model.
- It does not add P-stage implementation prompts.

## Part 4: Setup, Onboarding, And Daily Operation Flows

Part 4 describes the operator lifecycle. It uses the primitives and contracts
from Parts 2 and 3 and does not add implementation prompts.

## First Run Flow

`ductum start` is the main entrypoint.

If no Factory exists, `ductum start` opens the setup wizard. It does not drop
the operator into an empty dashboard with hidden missing prerequisites.

If a Factory already exists and the app is running, `ductum start` opens or
connects to the existing app. If the app is not running, it starts the local
control plane and opens the app.

Starting Ductum does not start work by itself. Work begins only when a Project
is ready, a Spec is ready, and the operator or project policy starts eligible
Tasks.

## Factory Setup Flow

Factory setup is complete when the operator can add a Project, create or import
a Spec for that Project, and put the Spec into motion.

The setup wizard should establish:

- Factory name and data directory.
- Local app access and operator authentication.
- Background/service preference.
- At least one usable Provider auth path when the operator wants agents during
  setup.
- At least one valid Agent or a clear path to create one before Project
  onboarding completes.

Setup should show what it will write before saving. Setup should not require
the operator to understand the internal resource graph.

Provider auth can happen during Factory setup and during Agent creation. The
setup flow should detect existing usable auth and should not ask for providers
that the operator is not enabling.

## Agent Creation Flow

The normal Agent creation flow is guided:

1. Choose or write the role/system prompt.
2. Choose a Harness.
3. Choose a compatible Provider.
4. Choose a compatible Model from that Provider.
5. Choose effort/settings.
6. Name the Agent.
7. Validate before save.

Ductum should only offer compatible Provider and Model choices for the selected
Harness. If auth is missing for the selected Provider, the Agent creation flow
should route through Provider auth before save.

Agents are created in Factory Settings. Projects assign existing Agents. Project
onboarding can link to Agent creation when no suitable Agent exists, but it
should not hide a new global Agent definition inside project setup.

## Project Onboarding Flow

Project onboarding starts from where the code or docs live.

If the operator is inside a Git repository, Ductum should offer that repository
first. Otherwise, it asks for a local path or remote repository and infers a
Project name for confirmation.

Project onboarding collects and validates:

- Project name.
- One or more Repositories.
- Repository readiness for the selected workflow.
- Optional Components suggested from repository structure.
- Workflow selection.
- Agent assignments from Factory-level Agents.
- Branch and merge defaults.

A Project is saved only when it is ready. Ready means it has at least one valid
Repository, valid workflow selection, valid Agent assignments, and can accept
Specs.

Local-only repositories are allowed for local workflows. Remote merge,
pull-request, and deployed-factory workflows require Git remote and credential
readiness before work can start.

If no workflow exists in the repository, Ductum offers built-in workflow presets
and requires the operator to choose one. The operator should not need to create
a workflow file before onboarding a Project.

Once selected, the Project points at a Workflow record in Factory Settings.
Repository workflow files can be imported or re-imported into that record, but
they are not a second live source of truth.

## Repository Readiness Flow

Repository readiness is contextual.

For local-only work, Ductum needs a readable Git repository or a path that the
operator explicitly initializes as Git.

For remote merge or pull-request workflows, Ductum must know that remote access
is ready before Attempts start. Readiness includes remote configuration,
credential availability, fetch ability, local branch creation, and known push
readiness.

Readiness failures do not become late Attempt failures. They block Spec start or
Task start with exact field/path errors and suggested fixes.

## Spec Intake Flow

Specs are created inside a Project.

Normal Spec intake can come from the UI or CLI:

- write or paste a work request;
- upload or import a Spec file;
- import an existing design artifact;
- receive a WorkPackage/SpecIntake payload from Qratum or another generator;
- create a Spec from a guided form.

The operator chooses one or more target Repositories. Ductum may suggest
Repositories or Components from the Spec text and recent project history, but
the operator confirms the scope before the Spec starts.

A Spec can exist before every target is ready, but it cannot start Attempts
until its target Repositories and optional Components are ready.

## Work Execution Flow

Work starts from a ready Spec.

Starting a Spec creates or activates Tasks. Each Task targets a Repository and
may target a Component. Queued Tasks use the latest valid config when their
Attempt starts, except for queued work affected by Workflow edits where the
operator already chose whether to keep the old Workflow or apply the new one.

For multi-repository Specs, the work view must make fan-out explicit. The
operator should see one Spec with Repository-scoped Tasks underneath, not a flat
pile of unrelated Attempts. Approval and merge grouping are governed by the
Workflow.

Each Attempt snapshots full runtime context before it starts. After that,
config changes do not affect the active Attempt.

The running work view should emphasize Spec and Task progress first, with
Attempts visible underneath. Attempt detail shows stage, logs, cost, branch,
health, evidence, approvals, and execution location.

Factory Activity summarizes active Attempts, queue movement, blockers, recent
events, and next operator actions across Projects.

## Review And Approval Flow

Review is a work phase or check. It may create reviewer Attempts and review evidence or
verdicts.

Approval is the operator decision. What approval means is governed by the
Workflow. A conservative workflow may require approval before merge. A lighter
workflow may approve at the Spec result level. The UI should show the concrete
action being approved, not only the internal stage name.

The operator should be able to review:

- what changed;
- which Repository and Component were affected;
- which Agent and Harness ran;
- which Workflow and Model snapshot were used;
- verification result;
- review verdict;
- branch, commit, or pull request;
- cost and notable events.

Approval records are audit records.

## Failure Flow

Failures should follow workflow policy before interrupting the operator.

Expected implementation failures can route to fix Attempts according to the
Workflow. Agent or runtime failures can rotate away from unhealthy Agents when a
healthy eligible Agent exists, but rotation starts a new Attempt with a new
snapshot. Budget, auth, Git readiness, workflow, and config failures should stop
with exact errors instead of retrying blindly.

When Ductum cannot proceed safely, it asks the operator for a repair, retry,
skip, cancel, or approval decision depending on the Workflow.

## Restart And Stop Flow

After restart, Ductum reconciles active Attempts.

If an Attempt can be reattached, Ductum reattaches it. If it cannot, Ductum marks
it interrupted or recoverable with an exact reason and shows the next action.

Stopping Ductum is an operator choice:

- drain active Attempts;
- cancel active Attempts;
- force stop and mark affected Attempts interrupted.

The default should avoid orphaned state. Forced stop remains available for
emergencies.

## Repair Flow

Broken config and project readiness are fixed through UI-first repair flows with
CLI support.

Repair screens point to exact fields and records. They should use the operator
model names, not legacy YAML keys or internal enum values.

If a Project is broken while the Factory is running, Ductum disables dispatch for
that Project and keeps valid Projects working.

## Migration Flow

The redesigned first run detects an existing legacy `ductum.yaml` and offers a
one-time migration.

Migration backs up the old file, validates the full graph before writing, and
imports:

- Factory settings.
- Models, Harnesses, Workflows, sandbox profiles, notification channels, and
  Agents into Factory Settings.
- Projects.
- Project repo entries as Repositories.
- Old targets as Repository scope, branch/workflow metadata, and task target
  mappings; these inputs are deduplicated under the Part 6 migration rules.
  Components are created only when the mapping is clear.
- Existing Tasks remapped from old target IDs to Repository plus optional
  Component scope.
- Existing Runs surfaced as legacy Attempts with partial historical snapshots.
- Project Agent assignments.

If migration finds invalid references, it stops before writing and reports exact
records and fields to fix.

After successful migration, the old `ductum.yaml` no longer drives startup. It
is replaced by or accompanied by a minimal receipt/pointer.

## Boring Normal Path

The redesign optimizes for this loop:

1. Run `ductum start`.
2. Finish setup if needed.
3. Open a Project.
4. Confirm Repositories, Workflow, and Agents are ready.
5. Create or import a Spec.
6. Confirm target Repositories.
7. Start work.
8. Monitor Spec, Tasks, Attempts, and Factory Activity.
9. Review the result.
10. Approve, retry, repair, cancel, or merge.

For multi-repository Specs, the same loop still applies, but the Spec view shows
fan-out by Repository and Task so the operator can approve or repair grouped
work without understanding the old target graph.

Advanced concepts stay available, but this loop must not require the operator to
understand seed ordering, generic resources, runtime worktrees, dispatcher
state, or model/harness ID drift.

## Acceptance For Part 4

This part is accepted only when:

- It describes the first-run and daily operator loop end to end.
- It keeps setup, onboarding, and execution separate.
- It makes Project onboarding possible without hand-editing config.
- It makes Spec intake project-scoped and Repository-scoped.
- It explains how failures, restart, stop, repair, and migration behave.
- It does not add implementation prompts.

## Part 5: UI And CLI Information Architecture

Part 5 defines the operator surfaces and words. It does not define component
layouts, routes, database schema, or implementation prompts.

## UI Principles

The UI is a control surface, not a database browser.

Every normal screen must answer at least one operator question:

- What is running?
- What is ready?
- What is blocked?
- What needs my decision?
- Where do I add work?
- Where do I fix setup?

Normal UI must use the operator model names from Part 2 and Part 3. It must not
make the operator reconcile internal state names.

## Primary Navigation

The primary UI navigation should be:

- Home
- Projects
- Factory Activity
- Factory Settings
- Repair

Project-scoped objects live under Projects. Specs, Tasks, Attempts,
Repositories, Components, and Project settings should be reached through a
Project first.

Factory-wide configuration lives under Factory Settings. Agents, Providers,
Models, Harnesses, Workflows, sandbox profiles, notifications, budgets, and app
settings should be reached there.

Repair appears only when something needs attention or when the operator opens it
directly.

## Home

Home is the operator's starting point after setup.

Home should show:

- setup incomplete state, when setup is incomplete;
- project summary;
- Factory Activity summary;
- next actions;
- recent blockers or approvals;
- links into Projects and Repair.

Home should not show raw resource tables, seed status, internal dispatcher
state, raw enum labels, or every low-level runtime record.

## Projects

Projects is the daily working surface.

The Projects list shows each Project's readiness, active Specs, active Attempts,
blocked work, and recent outcome. It should not require the operator to know
which repositories or components exist before choosing a Project.

Project detail shows:

- Project status and readiness.
- Repositories.
- optional Components.
- Specs.
- active Tasks and Attempts.
- assigned Agents.
- selected Workflow.
- branch/merge defaults.
- Project-specific repair items.

Repositories are the required source boundary. Components are optional and
should appear only when they exist or when Ductum has useful suggestions.

## Specs, Tasks, And Attempts

Specs live inside a Project.

A Spec page should show:

- intent/document;
- target Repositories and optional Components;
- Tasks;
- progress;
- review and approval state;
- relevant decisions and evidence;
- next available action.

Tasks are the concrete work units inside a Spec. A Task page should show target
Repository, optional Component, assigned Agent or required role, status,
verification, Attempts, and blockers.

Attempts are execution tries. Attempt detail should show runtime snapshot,
stage, logs, cost, branch, commit or pull request, evidence, approvals,
heartbeat/health, and outcome.

The normal UI word is Attempt. Run is not a normal UI word in the redesigned
contract.

## Factory Activity

Factory Activity is the runtime overview.

It should show:

- active Attempts;
- queued work;
- blocked work;
- recent completions;
- cost and budget pressure;
- unhealthy Agents;
- service/daemon status;
- recent important events.

Factory Activity may summarize dispatcher, queue, worker, worktree, and sandbox
state. It should not require the operator to understand those internals unless
they open debug details.

## Factory Settings

Factory Settings replaces generic resource management.

Factory Settings sections:

- Agents.
- Providers.
- Models.
- Harnesses.
- Workflows.
- Sandboxes.
- Notifications.
- Budgets.
- App and service settings.
- Import/export/backup.

The word resource should not appear in normal Factory Settings navigation.

The old public `resource` CLI namespace, skill instructions, and docs are part
of the public wording cutover. They must either move behind explicit
migration/debug compatibility or be replaced by Factory Settings commands before
the redesigned contract is considered active.

Agent creation uses the guided flow from Part 4: role/system prompt, Harness,
Provider, Model, settings, name, validation.

Provider pages show auth status and available Models without exposing secrets.

Workflow pages show presets, imported workflows, custom workflows, validation,
and where each Workflow is used.

## Repair

Repair is where broken readiness, invalid config, migration failures, provider
auth problems, Git readiness problems, and isolated Projects are fixed.

Repair items must point to exact records and fields using operator words.

Repair should show:

- what is broken;
- what it blocks;
- exact field or setting;
- suggested fix;
- whether valid Projects can continue running.

Repair is UI-first. CLI support exists for automation and remote sessions.

## CLI Shape

`ductum start` is the main entrypoint. It starts or opens the app/control plane.

The default CLI/status output should combine:

- project summary;
- Factory Activity;
- next actions.

Public CLI command names should use operator words:

```text
ductum start
ductum status
ductum project ...
ductum repository ...
ductum component ...
ductum spec ...
ductum task ...
ductum attempt ...
ductum agent ...
ductum provider ...
ductum model ...
ductum harness ...
ductum workflow ...
ductum factory ...
ductum repair ...
```

Old public words should not be documented in the redesigned contract. In
particular:

- use Attempt, not Run;
- use Repository and optional Component, not Target;
- use Factory Settings, not Resources;
- use applying configuration, not seed.

Debug and migration commands may expose lower-level language when necessary, but
normal command help should not teach the old model.

The redesigned CLI also needs a clear replacement for the current developer
`pnpm serve` habit. `pnpm serve` can remain a contributor command, but normal
operator documentation should point at `ductum start`.

## JSON And Error Names

Public JSON and error responses use the same operator names as UI and CLI.

Errors should identify:

- record type;
- record name or ID;
- field path;
- human label;
- invalid value or missing dependency;
- suggested action.

Raw internal enum values are not primary user-facing labels. Debug output may
include them as secondary fields.

## Advanced And Debug Views

Advanced views may expose runtime internals:

- dispatcher;
- queue;
- worker;
- worktree;
- sandbox;
- session binding;
- adapter key;
- raw event name;
- raw enum value.

These views are not part of the normal first successful loop. They are for
debugging, migration, and development.

## Forbidden Normal-UI Words

The normal UI should not use:

- resource, as a generic noun;
- seed or seeding;
- target;
- run, when Attempt is meant;
- dispatcher as the primary label;
- queue as the primary home-page model;
- raw enum values as status labels.

These words may still exist internally or in debug-only views during migration.

## Acceptance For Part 5

This part is accepted only when:

- It defines the top-level UI surfaces.
- It keeps Project as the daily navigation unit.
- It puts Factory-wide configuration under Factory Settings.
- It requires retiring or hiding the old public resource surface in the
  redesigned contract.
- It makes Specs, Tasks, and Attempts project-scoped.
- It defines the public CLI vocabulary.
- It bans old/internal words from normal UI.
- It keeps advanced/debug internals out of the first successful loop.
- It does not add implementation prompts.

## Part 6: Validation, Repair, Migration, And Safety

Part 6 locks the safety rules around the redesigned model. It consolidates the
validation, repair, migration, secrets, deployment, and supply-chain boundaries
needed before implementation prompts are written.

## Validation Phases

Ductum validates before mutation.

Validation happens in phases:

1. **Input validation** checks shape, required fields, known enum values, and
   field types before save.
2. **Reference validation** checks that IDs, names, and external keys resolve to
   the expected record type.
3. **Compatibility validation** checks Provider, Model, Harness, Agent,
   Workflow, sandbox, and effort compatibility before saving enabled config.
4. **Readiness validation** checks host-specific prerequisites such as Git
   access, provider auth, repository readiness, and workflow readiness before
   work starts.
5. **Snapshot validation** checks full Attempt runtime context immediately before
   an Attempt starts.

Achieving this requires inverting the current start-then-seed behavior. The
redesigned startup path must validate the full graph before writing Factory,
Agent, Project, Repository, Workflow, or assignment state.

Config records use strict save. Invalid config cannot be saved as normal
enabled configuration.

Specs may exist before targets are ready, but they cannot start Attempts until
their target Repositories and optional Components pass readiness validation.

## Error Contract

Errors must be exact and actionable.

Every normal API, UI, and CLI error should identify:

- record type;
- record name and stable ID when available;
- field path;
- human label;
- invalid value or missing dependency;
- whether the error blocks save, Project readiness, Spec start, or Attempt
  start;
- suggested action.

Errors should use operator words. They should not lead with old YAML paths,
internal table names, or raw enum values.

Legacy migration errors may include old `ductum.yaml` keys as secondary context,
but the primary explanation should name the new operator record and field.

## Repair Rules

Repair is UI-first with CLI support.

Repair items should be grouped by what they block:

- Factory setup.
- Project readiness.
- Repository readiness.
- Agent readiness.
- Provider auth.
- Workflow validity.
- Spec start.
- Attempt recovery.
- Migration.

A broken Project disables dispatch only for that Project. Valid Projects keep
working.

Repair must not require the operator to edit the database, hand-edit YAML, or
understand seed ordering.

## Migration Rules

Migration from current `ductum.yaml` is a one-time big-bang import.

Migration must:

- back up the legacy file before writing new state;
- validate the full legacy graph before writing;
- stop before mutation when references are broken;
- report exact legacy source keys and new operator fields;
- import Factory Settings;
- import Projects;
- merge `projects.*.repos` and old `targets` into Repository records without
  duplicating the same repo;
- move target branch defaults to Repository or Project/Repository branch
  settings;
- move target workflow references to Project Workflow selection;
- stop before writing if multiple old targets in the same Project reference
  different workflows and no unambiguous single Project Workflow can be chosen;
- create Components only when the old target clearly maps to a sub-area;
- import Agents, Models, Harnesses, Workflows, sandbox profiles, notification
  channels, and project Agent assignments;
- remap existing Tasks from old target IDs to Repository plus optional
  Component scope;
- present existing Runs as legacy Attempts without inventing full snapshots;
- write or preserve a minimal receipt/pointer after success.

After migration, `ductum.yaml` no longer drives startup.

No long dual-read compatibility period is part of this redesign. Ductum is still
operated by one primary user, so the simpler honest path is a clean cutover with
backup and exact failure reports.

## Secrets And Credentials

Secrets are never stored in normal config, migration exports, logs, evidence,
or public JSON responses.

Ductum may store references to credentials, auth status, Provider names, and
non-secret readiness metadata. Secret values live in environment variables,
provider CLI auth stores, OS keychains, service secret files, or another explicit
secret mechanism selected later.

Provider pages may show:

- Provider enabled state;
- auth detected or missing;
- credential source type, without secret value;
- Models available through that Provider;
- readiness errors and suggested login/setup actions.

Attempt snapshots may include non-secret readiness metadata, but not API keys,
tokens, refresh tokens, raw credential files, or private auth payloads.

## Deployment Prerequisites

The redesigned model treats laptop, Mac mini, Linux VM, and AWS VM as the same
Factory shape.

A host running Ductum needs the prerequisites required by the selected workflows
and Harnesses. Examples:

- Git.
- GitHub CLI or equivalent Git credentials when GitHub workflows are enabled.
- Node or packaged Ductum runtime, depending on distribution shape.
- Provider CLIs or auth stores used by selected Harnesses.
- writable Factory data directory.
- reachable local app port.
- service/background process setup when enabled.

Prerequisite checks belong in setup, Project onboarding, Agent creation, and
Repair. They should not surprise the operator during an Attempt after work has
already started.

## Supply-Chain Rules

The redesign does not loosen existing supply-chain rules.

Implementation must preserve:

- exact dependency pins;
- committed lockfile changes;
- no blind upgrades;
- no unapproved git or tarball dependencies;
- no install scripts unless explicitly approved;
- package verification before new dependencies;
- frozen lockfile in CI and scripted installs.

This spec does not approve new dependencies. Any implementation prompt that
needs one must record the reason and follow the existing supply-chain decision
process.

## Audit And Evidence Rules

Approvals, evidence, decisions, and important lifecycle events are audit
records.

Audit records should answer:

- who or what made the decision;
- what was decided;
- what record it affected;
- what evidence existed at the time;
- which Attempt snapshot was used;
- what changed after the decision.

Audit records should not contain secrets or unnecessary raw content.

## Out Of Scope For This Part

This part does not define:

- database migrations;
- endpoint shapes;
- UI component layouts;
- CLI argument details;
- specific secret storage implementation;
- service manager implementation;
- implementation prompt order.

## Acceptance For Part 6

This part is accepted only when:

- It defines validation phases before mutation.
- It defines actionable error requirements.
- It keeps repair UI-first and field-specific.
- It makes migration a backed-up big-bang cutover.
- It keeps secrets out of config, logs, exports, JSON, and evidence.
- It keeps laptop, Mac mini, Linux VM, and AWS VM under one prerequisite model.
- It preserves existing supply-chain rules.
- It does not add implementation prompts.

## Part 7: Design Acceptance And Drift Rules

Part 7 closes the design draft. It defines what must be accepted before
implementation prompts are written.

## Design Acceptance

This redesign is accepted only when the operator model is clearly smaller than
the current factory graph.

Acceptance requires:

- `ductum.yaml` is no longer the daily source of truth.
- Projects are the main daily navigation unit.
- Repositories are the required source boundary.
- Components are optional.
- Specs, Tasks, and Attempts are scoped inside Projects.
- Factory Settings owns global Agents, Providers, Models, Harnesses, Workflows,
  sandboxes, notifications, budgets, and app settings.
- Public UI, CLI, API, JSON, and errors use the operator model names.
- Runtime state is separate from human config.
- New Attempts snapshot full runtime context before start.
- Legacy Runs are displayed honestly as legacy Attempts with partial historical
  snapshots.
- Active Attempts are stable against later config changes.
- Validation happens before mutation.
- Repair points to exact records and fields.
- Migration from current `ductum.yaml` is one backed-up cutover.
- Secrets stay out of config, logs, evidence, exports, and public JSON.
- Supply-chain rules remain intact.
- Harness enforcement remains structural, not advisory.

## Redesign Non-Goals

This design still does not implement:

- new agent harnesses;
- new AI providers;
- new workflow enforcement semantics;
- a marketplace;
- a cloud service;
- replacing Edictum workflow runtime;
- rewriting the whole dashboard;
- changing historical run records;
- removing compatibility without migration;
- implementation prompts.

## Drift Rules

Implementation work must not silently reintroduce the old model.

Record a decision before any implementation stage:

- makes `ductum.yaml` authoritative again;
- exposes generic resources in normal UI;
- leaves the old public resource CLI as the documented normal path;
- uses Target or Run as public redesigned names;
- makes Components required for onboarding;
- treats local paths as portable identity;
- saves invalid enabled config;
- lets active Attempts follow later config changes;
- starts dispatch just because `ductum start` ran;
- exposes secrets in config, logs, evidence, exports, or public JSON;
- adds dependencies;
- changes workflow enforcement semantics;
- bypasses Edictum enforcement boundaries.

## Before Implementation

Before implementing any stage:

- Read this full design.
- Read the stage prompt.
- Keep the stage scope narrow.
- Record a decision before drifting.
- Ductum may now be used as executor for later polish stages, subject to the
  post-P9 hardening spec and normal verification gates.

## Final Acceptance

The design draft is complete when:

- Parts 1 through 7 are internally consistent.
- The normal operator path is understandable without knowing resources, seed,
  targets, runs, dispatcher internals, or startup seed ordering.
- A single-repo project and a multi-repo project both fit naturally.
- A local laptop, Mac mini, Linux VM, and AWS VM all fit the same Factory model.
- The current concrete failure, `Agent codex modelRef not found: gpt-5-4`, is
  addressed by the model through pre-mutation validation, exact field errors,
  and clearer identity boundaries. The model does not pretend look-alike
  operator IDs and provider IDs cannot still be chosen; it makes the failure
  early and specific.
- Implementation prompts are split into small stages and linked below.

## Part 8: Implementation Prompt Split

Implementation should be Codex-direct until startup, migration, Project
onboarding, and the Attempt facade are stable. Claude or another reviewer should
review the design and final implementation slices, but Ductum should not execute
the early stages that replace its own operational model.

## P0 Outcome

Status: accepted.

Reviewer: Claude / operator-reviewed.

Date: 2026-05-25.

Blocking contradictions: none remaining.

Follow-up notes:

- WorkPackage input stops at Task; Attempts are runtime records created by
  Ductum.
- P1-P9 may now move from `pending P0` to staged execution, starting with P1.

## P9 Outcome

Status: pass.

Date: 2026-06-09.

Final verdict: PASS. The latest P9 delta review found no remaining blocking
operator-model regressions after the blocker fixes landed in `15ab5e4`.

Accepted:

- The normal operator path uses Factory, Project, Repository, Component, Spec,
  Task, and Attempt instead of requiring operators to reason in old
  Target/Run/resource terms.
- `ductum.yaml` is no longer the daily source of truth after setup/migration;
  migrated state and legacy Attempts are displayed honestly.
- Factory Settings and Repair cover Providers, Models, Harnesses, Workflows,
  Agents, prerequisites, workflow validity, and secret-safety checks with
  field-specific operator feedback.
- Project onboarding, Repository scoping, Spec import/create, Task fan-out,
  Attempt start/detail, review/approval, and controlled blockers fit the
  redesigned public contract.
- Valid Projects can continue even when another Project is broken.
- P7 CLI/UI cutover, P8 repair/prerequisite/safety, and P9 final gate are
  complete.

Post-P9 hardening remains tracked separately in
`specs/current/post-p9-hardening/README.md`. It is accepted polish, not a
condition for closing this arc. Ductum may dogfood those later stages.

## Execution Order

| # | Prompt | Scope | Executor | Status |
|---|---|---|---|---|
| 0 | [P0-DESIGN-CONTRADICTION-REVIEW.md](P0-DESIGN-CONTRADICTION-REVIEW.md) | final design review | Claude/reviewer | accepted |
| 1 | [P1-PUBLIC-CONTRACT-FACADE.md](P1-PUBLIC-CONTRACT-FACADE.md) | operator contract DTOs, WorkPackage, naming facade, error paths | Codex direct | done |
| 2 | [P2-FACTORY-DATA-STARTUP.md](P2-FACTORY-DATA-STARTUP.md) | Factory data dir, startup boundary, pre-mutation preflight | Codex direct | done |
| 3 | [P3-FACTORY-SETTINGS-CATALOGS.md](P3-FACTORY-SETTINGS-CATALOGS.md) | Providers, Models, Harnesses, Workflows, Agents, validation | Codex direct | done |
| 4 | [P4-PROJECT-REPOSITORY-COMPONENT.md](P4-PROJECT-REPOSITORY-COMPONENT.md) | Project onboarding, Repository, optional Component, Target bridge | Codex direct | done |
| 5 | [P5-SPEC-TASK-ATTEMPT.md](P5-SPEC-TASK-ATTEMPT.md) | WorkPackage runtime path, Attempt facade, snapshots, fan-out views | Codex direct | done |
| 6 | [P6-LEGACY-MIGRATION.md](P6-LEGACY-MIGRATION.md) | one-time `ductum.yaml` migration and legacy Run handling | Codex direct | done |
| 7 | [P7-UI-CLI-CUTOVER.md](P7-UI-CLI-CUTOVER.md) | CLI/UI cutover umbrella; split before execution | Codex direct | done/pass |
| 8 | [P8-REPAIR-PREREQ-SAFETY.md](P8-REPAIR-PREREQ-SAFETY.md) | repair flows, prerequisites, secrets, supply-chain gates | Codex direct | done/pass |
| 9 | [P9-FINAL-REVIEW-AND-DEMO.md](P9-FINAL-REVIEW-AND-DEMO.md) | final review, demo, dogfood gate | Claude review + Codex fixes | done/pass |

## Stage Rules

- Each stage must preserve the existing supply-chain rules.
- Each stage must run `git diff --check`.
- Runtime code stages must run relevant package tests and any broader build/test
  gate named by the stage.
- Do not rename or remove historical records without a migration path.
- Do not use old public words as the normal redesigned interface.
- Do not make `ductum.yaml` authoritative again.
- Do not claim Ductum can coordinate multiple Factory hosts without a future
  coordination decision.
