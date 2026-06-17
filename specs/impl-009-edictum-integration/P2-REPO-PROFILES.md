# P1: Repo Workflow Profiles

**Scope:** Per-repo workflow profile, template renderer, ductum.yaml integration
**Package:** `packages/core`
**Depends on:** None
**Deliverable:** Concrete workflow YAML rendered per-project from repo profile + template

---

## Required Reading

- `specs/impl-009-edictum-integration/spec.md` (full spec)
- `edictum-harness/specs/m1/013-workflow-repo-profiles.md` (original design)
- `workflows/coding-guard.yaml` (current static workflow)
- `ductum.yaml` (project config)
- `packages/core/src/enforce.ts` — `initialize()` loads workflow from static path

## Design

### Two-layer model (from spec 013)

**Layer 1 — Shared template** (`workflows/coding-guard-template.yaml`):
Standard 10-stage workflow with placeholder variables:

```yaml
stages:
  - id: read-analyze
    tools: [Read, Grep, Glob]
    exit:
      - condition: file_read("${REQUIRED_READ}")
        message: Read ${REQUIRED_READ} before editing

  - id: baseline-verify
    tools: [Read, Grep, Bash]
    checks:
      - command_matches: '${VERIFY_PATTERN}'
        message: Only verification commands allowed
    exit:
      - condition: 'command_matches("${VERIFY_PATTERN}")'

  - id: local-verify
    tools: [Read, Grep, Bash]
    checks:
      - command_matches: '${VERIFY_PATTERN}'
    exit:
      - condition: 'command_matches("${VERIFY_PATTERN}")'

  # ... other stages unchanged
```

**Layer 2 — Repo profile** (`.edictum/workflow-profile.yaml` in each repo):

```yaml
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: ductum
context:
  required_files: [README.md, CLAUDE.md]
  optional_files: [AGENTS.md]
verify:
  commands: [pnpm build, pnpm -r test]
push:
  protected_branches: [main]
```

### Renderer

New file: `packages/core/src/workflow-renderer.ts`

```typescript
interface RepoProfile {
  context: { required_files: string[]; optional_files?: string[] }
  verify: { commands: string[] }
  push: { protected_branches: string[] }
}

function renderWorkflow(templatePath: string, profile: RepoProfile): string
// Returns concrete workflow YAML with variables substituted
```

The renderer:
1. Reads the template
2. Substitutes `${REQUIRED_READ}` → first required_files entry
3. Builds `${VERIFY_PATTERN}` from profile verify commands as a regex alternation
4. Substitutes `${PROTECTED_BRANCHES}` for push checks
5. Writes the rendered YAML to a temp file (or returns the string for in-memory loading)

### ductum.yaml integration

```yaml
projects:
  ductum:
    repos:
      - path: /Users/acartagena/project/ductum
        name: ductum
    workflow:
      profile: .edictum/workflow-profile.yaml  # relative to repo root
      # OR: template: workflows/coding-guard.yaml (for repos without profiles)
```

If no profile is specified, fall back to the static `workflows/coding-guard.yaml`.

### EnforcementManager changes

`initialize()` currently loads a single static workflow path.
Change to: per-project workflow loaded from rendered profile.

The enforcement manager already creates per-run WorkflowRuntime instances (D27).
Add: the workflow definition is resolved per-project (from profile), not globally.

## Tasks

### 1. Create workflow-profile.yaml for the ductum repo

File: `.edictum/workflow-profile.yaml`

### 2. Create the template

File: `workflows/coding-guard-template.yaml`
Copy current `coding-guard.yaml` and replace hardcoded values with variables.

### 3. Build the renderer

File: `packages/core/src/workflow-renderer.ts`
- Parse profile YAML
- Substitute variables in template
- Return rendered WorkflowDefinition (or temp file path)

### 4. Update ductum.yaml and serve.mjs

Add `workflow.profile` to project config.

**Process boundary:** serve.mjs spawns the API as a separate process
(scripts/serve.mjs:93), so a live Map cannot cross directly. Two options:

**Option A (recommended):** The API process reads and renders profiles itself.
serve.mjs already passes DUCTUM_REPO_PATH_MAP as an env var. Add a second
env var DUCTUM_WORKFLOW_PROFILES that maps project names to profile file paths:
```
DUCTUM_WORKFLOW_PROFILES=ductum:/Users/.../ductum/.edictum/workflow-profile.yaml,faceless:/Users/.../faceless/.edictum/workflow-profile.yaml
```
The API process reads each profile, renders the workflow, and builds the
per-project WorkflowDefinition map in-process.

**Option B:** serve.mjs renders all workflows to temp files and passes the
rendered YAML paths via env var. Simpler but less flexible.

### 5. Update packages/api/src/index.ts (the wiring point)

**This is where the global workflow is currently loaded (line ~57).**

The API process reads DUCTUM_WORKFLOW_PROFILES env var, loads each profile,
renders each workflow from template + profile, and builds the map:

```typescript
const workflowDefs = new Map<ProjectId, WorkflowDefinition>()
for (const [projectName, profilePath] of parseWorkflowProfilesEnv()) {
  const profile = loadProfile(profilePath)
  const rendered = renderWorkflow(templatePath, profile)
  const projectId = resolveProjectId(projectName)
  workflowDefs.set(projectId, loadWorkflowString(rendered))
}
const enforcement = new EnforcementManager({
  workflowDefs,
  fallbackWorkflowPath: 'workflows/coding-guard.yaml',
  ...
})
```

### 6. Update EnforcementManager

Change constructor from `{ workflowPath: string }` to
`{ workflowDefs: Map<ProjectId, WorkflowDefinition>, fallbackWorkflowPath: string }`.

When creating a WorkflowRuntime for a run, resolve the project from the
task's spec, look up its WorkflowDefinition from the map. Fall back to
the global workflow loaded from fallbackWorkflowPath.

### 6. Tests

- Profile parsing
- Template rendering with different verify commands
- Fallback to static workflow when no profile exists
- Rendered workflow loads correctly in @edictum/core

## Verification

- [ ] ductum project uses pnpm build + pnpm -r test as verify commands
- [ ] Profile file parsed correctly from .edictum/workflow-profile.yaml
- [ ] Rendered workflow valid for @edictum/core loadWorkflow()
- [ ] Projects without profiles fall back to static coding-guard.yaml
- [ ] Tests cover rendering with different verify command sets
