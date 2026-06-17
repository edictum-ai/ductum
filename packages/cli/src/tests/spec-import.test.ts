import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import type { Component, Repository, Spec, Task, TaskDependency } from '@ductum/core'
import {
  parseExecutionOrderTable,
  parseDependsOnCell,
  parseYamlContent,
} from '../spec-import.js'
import { component, createMockApi, project, repository, runCommand, spec } from './helpers.js'

// --- Pure parsing tests ---

describe('parseExecutionOrderTable', () => {
  const README = `# Spec

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-CORE.md](P1-CORE.md) | core | Types | Types | [ ] | — |
| 2 | [P2-MACHINE.md](P2-MACHINE.md) | core | SM | SM | [ ] | P1 |
| 3 | [P3-DAG.md](P3-DAG.md) | core | DAG | DAG | [ ] | P1 |
| 4 | [P4-API.md](P4-API.md) | api | API | API | [ ] | P1, P2, P3 |
`

  it('parses the execution order table', () => {
    const rows = parseExecutionOrderTable(README)

    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({
      number: 1,
      promptFile: 'P1-CORE.md',
      taskName: 'P1-CORE',
      pkg: 'core',
      scope: 'Types',
      dependsOn: [],
    })
    expect(rows[1]?.dependsOn).toEqual(['P1'])
    expect(rows[3]?.dependsOn).toEqual(['P1', 'P2', 'P3'])
  })

  it('returns empty for content without a table', () => {
    expect(parseExecutionOrderTable('# No table here')).toEqual([])
  })

  it('handles en-dash and em-dash as no-deps', () => {
    const table = `| # | Prompt | Depends On |
|---|--------|------------|
| 1 | [A.md](A.md) | – |
| 2 | [B.md](B.md) | — |
| 3 | [C.md](C.md) | - |
`
    const rows = parseExecutionOrderTable(table)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.dependsOn).toEqual([])
    expect(rows[1]?.dependsOn).toEqual([])
    expect(rows[2]?.dependsOn).toEqual([])
  })

  it('extracts link targets from markdown links', () => {
    const table = `| # | Prompt | Depends On |
|---|--------|------------|
| 1 | [Display Name](actual-file.md) | — |
`
    const rows = parseExecutionOrderTable(table)
    expect(rows[0]?.promptFile).toBe('actual-file.md')
    expect(rows[0]?.taskName).toBe('actual-file')
  })
})

describe('parseDependsOnCell', () => {
  it('returns empty for dashes', () => {
    expect(parseDependsOnCell('—')).toEqual([])
    expect(parseDependsOnCell('–')).toEqual([])
    expect(parseDependsOnCell('-')).toEqual([])
    expect(parseDependsOnCell('')).toEqual([])
  })

  it('splits comma-separated references', () => {
    expect(parseDependsOnCell('P1')).toEqual(['P1'])
    expect(parseDependsOnCell('P1, P2, P3')).toEqual(['P1', 'P2', 'P3'])
    expect(parseDependsOnCell('P3, P7, P8, P9')).toEqual(['P3', 'P7', 'P8', 'P9'])
  })

  it('trims whitespace', () => {
    expect(parseDependsOnCell(' P1 , P2 ')).toEqual(['P1', 'P2'])
  })
})

describe('parseYamlContent', () => {
  const YAML = `
project: myproject
spec:
  name: test-spec
  status: approved
  document: Some description
tasks:
  - name: task-a
    prompt: Do thing A
    repos: [repo1]
    verification:
      - check 1
  - name: task-b
    prompt: Do thing B
    depends_on: [task-a]
`

  it('parses YAML spec content', () => {
    const result = parseYamlContent(YAML)

    expect(result.project).toBe('myproject')
    expect(result.spec.name).toBe('test-spec')
    expect(result.spec.status).toBe('approved')
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]?.name).toBe('task-a')
    expect(result.tasks[0]?.dependsOn).toEqual([])
    expect(result.tasks[1]?.name).toBe('task-b')
    expect(result.tasks[1]?.dependsOn).toEqual(['task-a'])
  })

  it('allows project override', () => {
    const result = parseYamlContent(YAML, 'override-project')
    expect(result.project).toBe('override-project')
  })

  it('rejects invalid dependency references', () => {
    const bad = `
project: p
spec:
  name: s
tasks:
  - name: x
    prompt: do x
    depends_on: [nonexistent]
`
    expect(() => parseYamlContent(bad)).toThrow('depends on "nonexistent" which is not defined')
  })

  it('rejects missing required fields', () => {
    expect(() => parseYamlContent('project: p\nspec:\n  name: s\n')).toThrow('Missing required field: tasks')
    expect(() => parseYamlContent('spec:\n  name: s\ntasks: []\n')).toThrow('Missing required field: project')
  })

  it('rejects non-object YAML', () => {
    expect(() => parseYamlContent('just a string')).toThrow('Invalid YAML content')
  })

  it('handles tasks without optional fields', () => {
    const minimal = `
project: p
spec:
  name: s
tasks:
  - name: t1
    prompt: do it
`
    const result = parseYamlContent(minimal)
    expect(result.tasks[0]?.repos).toEqual([])
    expect(result.tasks[0]?.verification).toEqual([])
    expect(result.tasks[0]?.dependsOn).toEqual([])
  })

  // --- requiredRole and status parsing ---

  it('parses requiredRole and status from YAML tasks', () => {
    const yaml = `
project: p
spec:
  name: s
tasks:
  - name: t1
    prompt: do it
    requiredRole: reviewer
    status: ready
  - name: t2
    prompt: do that
    requiredRole: builder
    status: pending
`
    const result = parseYamlContent(yaml)
    expect(result.tasks[0]?.requiredRole).toBe('reviewer')
    expect(result.tasks[0]?.status).toBe('ready')
    expect(result.tasks[1]?.requiredRole).toBe('builder')
    expect(result.tasks[1]?.status).toBe('pending')
  })

  it('omits requiredRole and status when not specified', () => {
    const minimal = `
project: p
spec:
  name: s
tasks:
  - name: t1
    prompt: do it
`
    const result = parseYamlContent(minimal)
    expect(result.tasks[0]?.requiredRole).toBeUndefined()
    expect(result.tasks[0]?.status).toBeUndefined()
  })

  it('rejects invalid requiredRole', () => {
    const bad = `
project: p
spec:
  name: s
tasks:
  - name: t1
    prompt: do it
    requiredRole: superadmin
`
    expect(() => parseYamlContent(bad)).toThrow(
      'tasks[0].requiredRole must be one of: builder, reviewer, docs, watcher',
    )
  })

  it('rejects invalid task status', () => {
    const bad = `
project: p
spec:
  name: s
tasks:
  - name: t1
    prompt: do it
    status: unknown
`
    expect(() => parseYamlContent(bad)).toThrow(
      'tasks[0].status must be one of: pending, blocked, ready, active, done, failed',
    )
  })

  // --- Feature parity template validation ---

  it('parses the feature-parity template with placeholders', () => {
    const TEMPLATE = `
project: edictum
spec:
  name: "parity-{{FEATURE_NAME}}"
  status: draft
  document: Roll out {{FEATURE_TITLE}} across the Edictum polyrepo ecosystem.
tasks:
  - name: "schemas-{{FEATURE_NAME}}"
    prompt: |
      {{SCHEMAS_PROMPT}}
      This is a schemas-only task.
    repos: [edictum-schemas]
    verification:
      - "{{SCHEMAS_VERIFY}}"
    depends_on: []
    complexity: standard

  - name: "python-{{FEATURE_NAME}}"
    prompt: |
      {{PYTHON_PROMPT}}
      This is an implementation task for the edictum (Python) SDK only.
    repos: [edictum]
    verification:
      - "{{PYTHON_VERIFY}}"
    depends_on:
      - "schemas-{{FEATURE_NAME}}"
    complexity: standard

  - name: "typescript-{{FEATURE_NAME}}"
    prompt: |
      {{TS_PROMPT}}
      This is an implementation task for the edictum-ts (TypeScript) SDK only.
    repos: [edictum-ts]
    verification:
      - "{{TS_VERIFY}}"
    depends_on:
      - "schemas-{{FEATURE_NAME}}"
    complexity: standard

  - name: "golang-{{FEATURE_NAME}}"
    prompt: |
      {{GO_PROMPT}}
      This is an implementation task for the edictum-go (Go) SDK only.
    repos: [edictum-go]
    verification:
      - "{{GO_VERIFY}}"
    depends_on:
      - "schemas-{{FEATURE_NAME}}"
    complexity: standard

  - name: "docs-{{FEATURE_NAME}}"
    assignedAgent: glm
    prompt: |
      {{DOCS_PROMPT}}
      This is a documentation task for edictum-docs only.
    repos: [edictum-docs]
    verification:
      - "{{DOCS_VERIFY}}"
    depends_on:
      - "python-{{FEATURE_NAME}}"
      - "typescript-{{FEATURE_NAME}}"
      - "golang-{{FEATURE_NAME}}"
    complexity: simple

  - name: "hub-{{FEATURE_NAME}}"
    assignedAgent: glm
    prompt: |
      {{HUB_PROMPT}}

      This is a content task for edictum-hub (the public website / marketing
      surface) only.

      A justified no-op is allowed here.
      If this feature has no meaningful site-level impact, do not force a
      fake marketing edit. Complete the task with an explicit rationale in
      your completion summary instead.

      Rules:
      - Content must reflect released reality, not roadmap
      - Keep messaging narrow: runtime trust layer, process enforcement,
        approvals, auditability
      - No internal details (agent names, run counts, ROI)
      - If you make no file changes, say exactly why edictum-hub does not
        need an update for this feature

      When done, call ductum_complete with a summary of what was changed.
    repos: [edictum-hub]
    verification:
      - "{{HUB_VERIFY}}"
      - "If edictum-hub is a no-op, completion summary explains why"
    depends_on:
      - "docs-{{FEATURE_NAME}}"
    complexity: simple
`
    const result = parseYamlContent(TEMPLATE)

    // Spec-level assertions
    expect(result.project).toBe('edictum')
    expect(result.spec.name).toBe('parity-{{FEATURE_NAME}}')
    expect(result.spec.status).toBe('draft')

    // Task count: 6 tasks (schemas + 3 runtimes + docs + hub)
    expect(result.tasks).toHaveLength(6)

    const byName = new Map(result.tasks.map((t) => [t.name, t]))

    // Phase 1: schemas — no deps, single repo
    const schemas = byName.get('schemas-{{FEATURE_NAME}}')!
    expect(schemas.repos).toEqual(['edictum-schemas'])
    expect(schemas.dependsOn).toEqual([])
    expect(schemas.complexity).toBe('standard')

    // Phase 2: three runtimes — each depends on schemas, different repos
    const python = byName.get('python-{{FEATURE_NAME}}')!
    expect(python.repos).toEqual(['edictum'])
    expect(python.dependsOn).toEqual(['schemas-{{FEATURE_NAME}}'])

    const ts = byName.get('typescript-{{FEATURE_NAME}}')!
    expect(ts.repos).toEqual(['edictum-ts'])
    expect(ts.dependsOn).toEqual(['schemas-{{FEATURE_NAME}}'])

    const go = byName.get('golang-{{FEATURE_NAME}}')!
    expect(go.repos).toEqual(['edictum-go'])
    expect(go.dependsOn).toEqual(['schemas-{{FEATURE_NAME}}'])

    // Phase 3: docs — depends on ALL THREE runtimes
    const docs = byName.get('docs-{{FEATURE_NAME}}')!
    expect(docs.repos).toEqual(['edictum-docs'])
    expect(docs.dependsOn).toContain('python-{{FEATURE_NAME}}')
    expect(docs.dependsOn).toContain('typescript-{{FEATURE_NAME}}')
    expect(docs.dependsOn).toContain('golang-{{FEATURE_NAME}}')
    expect(docs.dependsOn).toHaveLength(3)
    expect(docs.assignedAgent).toBe('glm')
    expect(docs.complexity).toBe('simple')

    // Phase 4: hub — depends on docs, explicit no-op path in prompt
    const hub = byName.get('hub-{{FEATURE_NAME}}')!
    expect(hub.repos).toEqual(['edictum-hub'])
    expect(hub.dependsOn).toEqual(['docs-{{FEATURE_NAME}}'])
    expect(hub.assignedAgent).toBe('glm')
    expect(hub.complexity).toBe('simple')
    expect(hub.prompt).toContain('A justified no-op is allowed here.')
    expect(hub.verification).toContain('If edictum-hub is a no-op, completion summary explains why')

    // Every task has exactly one repo (single-repo invariant)
    for (const task of result.tasks) {
      expect(task.repos).toHaveLength(1)
    }
  })

  it('parses a filled-in feature parity template with real values', () => {
    const FILLED = `
project: edictum
spec:
  name: parity-workflow-gates
  status: draft
  document: Roll out Workflow Gates across the Edictum polyrepo ecosystem.
tasks:
  - name: schemas-workflow-gates
    prompt: Add GateRule schema to edictum-schemas
    repos: [edictum-schemas]
    verification:
      - GateRule type exists in schemas
    depends_on: []

  - name: python-workflow-gates
    prompt: Implement workflow gates in Python SDK
    repos: [edictum]
    verification:
      - gate_check passes for valid transitions
    depends_on: [schemas-workflow-gates]

  - name: typescript-workflow-gates
    prompt: Implement workflow gates in TypeScript SDK
    repos: [edictum-ts]
    verification:
      - gate_check passes for valid transitions
    depends_on: [schemas-workflow-gates]

  - name: golang-workflow-gates
    prompt: Implement workflow gates in Go SDK
    repos: [edictum-go]
    verification:
      - gate_check passes for valid transitions
    depends_on: [schemas-workflow-gates]

  - name: docs-workflow-gates
    prompt: Document workflow gates across all SDKs
    repos: [edictum-docs]
    verification:
      - Docs page exists for workflow gates
    depends_on:
      - python-workflow-gates
      - typescript-workflow-gates
      - golang-workflow-gates

  - name: hub-workflow-gates
    prompt: Update marketing site for workflow gates
    repos: [edictum-hub]
    verification:
      - Hub page updated
    depends_on: [docs-workflow-gates]
`
    const result = parseYamlContent(FILLED)

    expect(result.project).toBe('edictum')
    expect(result.spec.name).toBe('parity-workflow-gates')
    expect(result.tasks).toHaveLength(6)

    // Verify DAG shape matches expected topology
    const byName = new Map(result.tasks.map((t) => [t.name, t]))

    // Schemas is root (no deps)
    expect(byName.get('schemas-workflow-gates')!.dependsOn).toEqual([])

    // Three runtimes depend only on schemas
    for (const name of ['python', 'typescript', 'golang']) {
      const task = byName.get(`${name}-workflow-gates`)!
      expect(task.dependsOn).toEqual(['schemas-workflow-gates'])
    }

    // Docs depends on all three runtimes
    const docs = byName.get('docs-workflow-gates')!
    expect(new Set(docs.dependsOn)).toEqual(
      new Set(['python-workflow-gates', 'typescript-workflow-gates', 'golang-workflow-gates']),
    )

    // Hub depends only on docs
    expect(byName.get('hub-workflow-gates')!.dependsOn).toEqual(['docs-workflow-gates'])
  })
})

// --- Command integration tests ---

describe('spec import command', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ductum-import-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('imports from a markdown directory', async () => {
    // Create fixture files
    const specDir = join(tmpDir, 'test-spec')
    await mkdir(specDir)

    await writeFile(join(specDir, 'README.md'), `# Test Spec

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-TYPES.md](P1-TYPES.md) | core | Types | Types | [ ] | — |
| 2 | [P2-LOGIC.md](P2-LOGIC.md) | core | Logic | Logic | [ ] | P1 |
| 3 | [P3-API.md](P3-API.md) | api | API | API | [ ] | P1, P2 |
`)
    await writeFile(join(specDir, 'P1-TYPES.md'), '# P1: Types\nBuild the types.')
    await writeFile(join(specDir, 'P2-LOGIC.md'), '# P2: Logic\nBuild the logic.')
    await writeFile(join(specDir, 'P3-API.md'), '# P3: API\nBuild the API.')

    let taskCounter = 0
    const createdTasks: Task[] = []
    const createdDeps: TaskDependency[] = []

    const api = createMockApi({
      createSpec: vi.fn().mockImplementation(async (_projectId, input) => ({
        ...spec,
        id: 'spec-import' as Spec['id'],
        name: input.name,
        status: input.status,
      })),
      listSpecs: vi.fn().mockResolvedValue([]),
      createTask: vi.fn().mockImplementation(async (_specId, input) => {
        taskCounter++
        const task: Task = {
          id: `task-${taskCounter}` as Task['id'],
          specId: 'spec-import' as Spec['id'],
          targetId: input.targetId ?? null,
          name: input.name,
          prompt: input.prompt,
          repos: input.repos ?? [],
          assignedAgentId: null,
          requiredRole: null,
          complexity: input.complexity ?? null,
          status: 'pending' as const,
          strategyRole: 'normal',
          strategyGroup: null,
          verification: input.verification ?? [],
          retryCount: 0,
          retryAfter: null,
          budgetExtraUsd: 0,
          turnExtraCount: 0,
          createdAt: '2026-04-05T00:00:00Z',
          updatedAt: '2026-04-05T00:00:00Z',
        }
        createdTasks.push(task)
        return task
      }),
      addTaskDependency: vi.fn().mockImplementation(async (taskId, dependsOnId) => {
        const dep = { taskId, dependsOnId }
        createdDeps.push(dep)
        return dep
      }),
      listTasks: vi.fn().mockImplementation(async () => createdTasks),
      listTaskDependencies: vi.fn().mockImplementation(async (taskId) =>
        createdDeps.filter((d) => d.taskId === taskId),
      ),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: ['task-1'] }),
    })

    const result = await runCommand(
      ['spec', 'import', specDir, '--project', 'ductum', '--waive-contract'],
      api,
    )

    expect(result.code).toBe(0)
    expect(api.createSpec).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ name: 'test-spec' }),
    )
    expect(api.createTask).toHaveBeenCalledTimes(3)
    expect(api.addTaskDependency).toHaveBeenCalledTimes(3) // P2->P1, P3->P1, P3->P2
    expect(api.evaluateDAG).toHaveBeenCalledWith('spec-import')
    expect(result.text).toContain('3 dependencies wired')
    expect(result.text).toContain('DAG evaluated')
    expect(result.text).toContain('P1-TYPES')
    expect(result.text).toContain('P2-LOGIC')
    expect(result.text).toContain('P3-API')
  })

  it('imports markdown directory tasks with default repository and component scope', async () => {
    const specDir = join(tmpDir, 'multi-repo-spec')
    await mkdir(specDir)
    await writeFile(join(specDir, 'README.md'), `# Multi Repo Spec

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-GATEWAY.md](P1-GATEWAY.md) | gateway | auth | auth | [ ] | - |
`)
    await writeFile(join(specDir, 'P1-GATEWAY.md'), '# P1\nBuild gateway auth.')

    const gatewayRepo: Repository = { ...repository, id: 'repo-gateway' as Repository['id'], name: 'gateway' }
    const infraRepo: Repository = { ...repository, id: 'repo-infra' as Repository['id'], name: 'infra' }
    const gatewayComponent: Component = {
      ...component,
      id: 'component-api' as Component['id'],
      repositoryId: gatewayRepo.id,
      name: 'api',
      spec: { path: 'packages/api' },
    }
    const createdTasks: Task[] = []
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([gatewayRepo, infraRepo]),
      listComponents: vi.fn().mockResolvedValue([gatewayComponent]),
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue({
        ...spec,
        id: 'spec-multi' as Spec['id'],
        name: 'multi-repo-spec',
      }),
      createTask: vi.fn().mockImplementation(async (_specId, input) => {
        const task: Task = {
          ...readyTaskForImport('task-multi', 'spec-multi'),
          name: input.name,
          prompt: input.prompt,
          repositoryId: input.repositoryId ?? null,
          componentId: input.componentId ?? null,
          repos: input.repos ?? [],
        }
        createdTasks.push(task)
        return task
      }),
      listTasks: vi.fn().mockResolvedValue(createdTasks),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: ['task-multi'] }),
    })

    const result = await runCommand([
      'spec',
      'import',
      specDir,
      '--project',
      'ductum',
      '--repository',
      'gateway',
      '--component',
      'api',
      '--waive-contract',
    ], api)

    expect(result.code).toBe(0)
    expect(api.createTask).toHaveBeenCalledWith('spec-multi', expect.objectContaining({
      name: 'P1-GATEWAY',
      repositoryId: gatewayRepo.id,
      componentId: gatewayComponent.id,
    }))
  })

  it('fails before creating a spec when multi-repo markdown import has no task scope', async () => {
    const specDir = join(tmpDir, 'missing-scope-spec')
    await mkdir(specDir)
    await writeFile(join(specDir, 'README.md'), `# Missing Scope

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-WORK.md](P1-WORK.md) | gateway | auth | auth | [ ] | - |
`)
    await writeFile(join(specDir, 'P1-WORK.md'), '# P1\nBuild gateway auth.')

    const gatewayRepo: Repository = { ...repository, id: 'repo-gateway' as Repository['id'], name: 'gateway' }
    const infraRepo: Repository = { ...repository, id: 'repo-infra' as Repository['id'], name: 'infra' }
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([gatewayRepo, infraRepo]),
      listSpecs: vi.fn().mockResolvedValue([]),
    })

    const result = await runCommand([
      'spec',
      'import',
      specDir,
      '--project',
      'ductum',
      '--waive-contract',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('requires --repository or task Repository metadata')
    expect(result.errorText).toContain('Available repositories: gateway, infra')
    expect(api.createSpec).not.toHaveBeenCalled()
    expect(api.createTask).not.toHaveBeenCalled()
  })

  it('imports from a YAML file', async () => {
    const yamlPath = join(tmpDir, 'spec.yaml')
    await writeFile(yamlPath, `
project: ductum
spec:
  name: yaml-spec
  status: approved
  document: A YAML spec
tasks:
  - name: task-alpha
    prompt: Do alpha
    repos: [ductum]
    verification:
      - check alpha
  - name: task-beta
    prompt: Do beta
    depends_on: [task-alpha]
`)

    let taskCounter = 0
    const createdTasks: Task[] = []

    const api = createMockApi({
      createSpec: vi.fn().mockImplementation(async (_projectId, input) => ({
        ...spec,
        id: 'spec-yaml' as Spec['id'],
        name: input.name,
      })),
      listSpecs: vi.fn().mockResolvedValue([]),
      createTask: vi.fn().mockImplementation(async (_specId, input) => {
        taskCounter++
        const task: Task = {
          id: `yt-${taskCounter}` as Task['id'],
          specId: 'spec-yaml' as Spec['id'],
          targetId: input.targetId ?? null,
          name: input.name,
          prompt: input.prompt,
          repos: input.repos ?? [],
          assignedAgentId: null,
          requiredRole: null,
          complexity: input.complexity ?? null,
          status: 'pending' as const,
          strategyRole: 'normal',
          strategyGroup: null,
          verification: input.verification ?? [],
          retryCount: 0,
          retryAfter: null,
          budgetExtraUsd: 0,
          turnExtraCount: 0,
          createdAt: '2026-04-05T00:00:00Z',
          updatedAt: '2026-04-05T00:00:00Z',
        }
        createdTasks.push(task)
        return task
      }),
      addTaskDependency: vi.fn().mockResolvedValue({ taskId: 'yt-2', dependsOnId: 'yt-1' }),
      listTasks: vi.fn().mockImplementation(async () => createdTasks),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: ['yt-1'] }),
    })

    const result = await runCommand(['spec', 'import', yamlPath, '--waive-contract'], api)

    expect(result.code).toBe(0)
    expect(api.createSpec).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ name: 'yaml-spec', status: 'approved' }),
    )
    expect(api.createTask).toHaveBeenCalledTimes(2)
    expect(api.addTaskDependency).toHaveBeenCalledWith('yt-2', 'yt-1')
    expect(api.evaluateDAG).toHaveBeenCalledWith('spec-yaml')
    expect(result.text).toContain('task-alpha')
    expect(result.text).toContain('task-beta')
  })

  it('passes requiredRole and status from YAML to createTask', async () => {
    const yamlPath = join(tmpDir, 'role-status.yaml')
    await writeFile(yamlPath, `
project: ductum
spec:
  name: role-status-spec
  status: approved
tasks:
  - name: review-task
    prompt: Review the code
    requiredRole: reviewer
    status: ready
  - name: build-task
    prompt: Build the feature
    requiredRole: builder
    depends_on: [review-task]
`)

    let taskCounter = 0
    const createdTasks: Task[] = []

    const api = createMockApi({
      createSpec: vi.fn().mockImplementation(async (_projectId, input) => ({
        ...spec,
        id: 'spec-rs' as Spec['id'],
        name: input.name,
      })),
      listSpecs: vi.fn().mockResolvedValue([]),
      createTask: vi.fn().mockImplementation(async (_specId, input) => {
        taskCounter++
        const task: Task = {
          id: `rs-${taskCounter}` as Task['id'],
          specId: 'spec-rs' as Spec['id'],
          targetId: input.targetId ?? null,
          name: input.name,
          prompt: input.prompt,
          repos: input.repos ?? [],
          assignedAgentId: null,
          requiredRole: input.requiredRole ?? null,
          complexity: input.complexity ?? null,
          status: input.status ?? 'pending',
          strategyRole: 'normal',
          strategyGroup: null,
          verification: input.verification ?? [],
          retryCount: 0,
          retryAfter: null,
          budgetExtraUsd: 0,
          turnExtraCount: 0,
          createdAt: '2026-04-05T00:00:00Z',
          updatedAt: '2026-04-05T00:00:00Z',
        }
        createdTasks.push(task)
        return task
      }),
      addTaskDependency: vi.fn().mockResolvedValue({ taskId: 'rs-2', dependsOnId: 'rs-1' }),
      listTasks: vi.fn().mockImplementation(async () => createdTasks),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: ['rs-1'] }),
    })

    const result = await runCommand(['spec', 'import', yamlPath, '--waive-contract'], api)

    expect(result.code).toBe(0)

    // Verify createTask received requiredRole and status
    expect(api.createTask).toHaveBeenCalledWith(
      'spec-rs',
      expect.objectContaining({
        name: 'review-task',
        requiredRole: 'reviewer',
        status: 'ready',
      }),
    )
    expect(api.createTask).toHaveBeenCalledWith(
      'spec-rs',
      expect.objectContaining({
        name: 'build-task',
        requiredRole: 'builder',
      }),
    )

    // Tasks that omit status should NOT have it in the input
    const buildCall = (api.createTask as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'build-task',
    )
    expect((buildCall?.[1] as Record<string, unknown>)?.status).toBeUndefined()
  })

  it('skips import when spec already has tasks', async () => {
    const yamlPath = join(tmpDir, 'existing.yaml')
    await writeFile(yamlPath, `
project: ductum
spec:
  name: P6
  status: approved
tasks:
  - name: t
    prompt: do
`)

    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([spec]),
      // listTasks already returns 3 tasks from default mock
    })

    const result = await runCommand(['spec', 'import', yamlPath, '--waive-contract'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('already has')
    expect(api.createTask).not.toHaveBeenCalled()
  })

  it('requires --project for directory imports', async () => {
    const specDir = join(tmpDir, 'no-project')
    await mkdir(specDir)
    await writeFile(join(specDir, 'README.md'), '# Empty')

    const result = await runCommand(['spec', 'import', specDir])

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('--project is required')
  })

  it('fails for nonexistent path', async () => {
    const result = await runCommand(['spec', 'import', '/nonexistent/path'])

    expect(result.code).toBe(1)
  })
})

function readyTaskForImport(id: string, specId: string): Task {
  return {
    id: id as Task['id'],
    specId: specId as Spec['id'],
    targetId: null,
    repositoryId: null,
    componentId: null,
    name: 'imported-task',
    prompt: 'prompt',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'pending',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: '2026-04-05T00:00:00Z',
    updatedAt: '2026-04-05T00:00:00Z',
  }
}

// --- Full impl-001 table parsing test ---

describe('parseExecutionOrderTable with real README', () => {
  const REAL_README = `# Ductum Implementation — Sequenced Prompts

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-CORE-TYPES.md](P1-CORE-TYPES.md) | core | Types, SQLite schema, repository pattern | All TS types, migrations, CRUD repos, DB setup | [ ] | — |
| 2 | [P2-STATE-MACHINE.md](P2-STATE-MACHINE.md) | core | Run state machine + @edictum/core integration | RunStateMachine class, authorize_tool, gate_check, workflow YAML | [ ] | P1 |
| 3 | [P3-DAG-EVALUATOR.md](P3-DAG-EVALUATOR.md) | core | Task/spec dependency resolution | DAG evaluator, re-evaluation on completion, status propagation | [ ] | P1 |
| 4 | [P4-REST-API.md](P4-REST-API.md) | api | REST API + SSE event stream | Hono server, CRUD routes, SSE, health check | [ ] | P1, P2, P3 |
| 5 | [P5-MCP-SERVER.md](P5-MCP-SERVER.md) | mcp | 12 agent-visible MCP tools | MCP server wrapping REST API | [ ] | P4 |
| 6 | [P6-CLI.md](P6-CLI.md) | cli | Command-line interface | Admin + agent commands over REST API | [ ] | P4 |
| 7 | [P7-HARNESS-CLAUDE.md](P7-HARNESS-CLAUDE.md) | harness | Claude Agent SDK adapter | Tool-call interception, session lifecycle, auto heartbeat, cost tracking | [ ] | P2, P4 |
| 8 | [P8-HARNESS-OPENCODE.md](P8-HARNESS-OPENCODE.md) | harness | OpenCode stateless plugin + adapter | Plugin, session-to-run mapping, crash detection | [ ] | P2, P4, P5 |
| 9 | [P9-WATCHERS.md](P9-WATCHERS.md) | core | CI + review watcher system | Watcher spawning, polling, evidence injection, latch resolution | [ ] | P2, P4 |
| 10 | [P10-DISPATCHER.md](P10-DISPATCHER.md) | core | Push-mode dispatcher | Auto-dispatch loop, agent matching, concurrent run coordination | [ ] | P3, P7, P8, P9 |
| 11 | [P11-DASHBOARD.md](P11-DASHBOARD.md) | dashboard | React dashboard | Project/spec/task/run views, DAG viz, SSE, approvals | [ ] | P4 |
`

  it('parses all 11 rows from impl-001 format', () => {
    const rows = parseExecutionOrderTable(REAL_README)

    expect(rows).toHaveLength(11)

    // Verify first task
    expect(rows[0]).toEqual({
      number: 1,
      promptFile: 'P1-CORE-TYPES.md',
      taskName: 'P1-CORE-TYPES',
      pkg: 'core',
      scope: 'Types, SQLite schema, repository pattern',
      dependsOn: [],
    })

    // Verify multi-dep task
    expect(rows[3]?.taskName).toBe('P4-REST-API')
    expect(rows[3]?.dependsOn).toEqual(['P1', 'P2', 'P3'])

    // Verify P10 dependencies
    expect(rows[9]?.taskName).toBe('P10-DISPATCHER')
    expect(rows[9]?.dependsOn).toEqual(['P3', 'P7', 'P8', 'P9'])

    // Verify P11
    expect(rows[10]?.taskName).toBe('P11-DASHBOARD')
    expect(rows[10]?.dependsOn).toEqual(['P4'])
  })

  it('builds correct dependency graph for all 11 tasks', () => {
    const rows = parseExecutionOrderTable(REAL_README)
    const numberToName = new Map(rows.map((r) => [r.number, r.taskName]))

    // Count total dependency edges
    let totalDeps = 0
    const resolved = rows.map((row) => {
      const deps = row.dependsOn
        .map((ref) => {
          const num = parseInt(ref.replace(/^P/i, ''), 10)
          return numberToName.get(num)
        })
        .filter((n): n is string => n != null)
      totalDeps += deps.length
      return { name: row.taskName, deps }
    })

    // P1: 0, P2: 1, P3: 1, P4: 3, P5: 1, P6: 1, P7: 2, P8: 3, P9: 2, P10: 4, P11: 1
    expect(totalDeps).toBe(19)

    // Verify specific dependency chains
    expect(resolved.find((r) => r.name === 'P2-STATE-MACHINE')?.deps).toEqual(['P1-CORE-TYPES'])
    expect(resolved.find((r) => r.name === 'P4-REST-API')?.deps).toEqual([
      'P1-CORE-TYPES', 'P2-STATE-MACHINE', 'P3-DAG-EVALUATOR',
    ])
    expect(resolved.find((r) => r.name === 'P10-DISPATCHER')?.deps).toEqual([
      'P3-DAG-EVALUATOR', 'P7-HARNESS-CLAUDE', 'P8-HARNESS-OPENCODE', 'P9-WATCHERS',
    ])
  })
})
