import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkflowString } from '@edictum/core'

import {
  loadWorkflowProfile,
  parseWorkflowProfile,
  renderWorkflow,
} from '../workflow-renderer.js'

const cleanup: string[] = []
const profilePath = fileURLToPath(
  new URL('../../../../.edictum/workflow-profile.yaml', import.meta.url),
)
const templatePath = fileURLToPath(
  new URL('../../../../workflows/coding-guard-template.yaml', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function createTempRepo(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ductum-workflow-profile-'))
  cleanup.push(root)
  mkdirSync(join(root, '.edictum'))
  for (const file of files) {
    writeFileSync(join(root, file), `${file}\n`)
  }
  return root
}

describe('workflow renderer', () => {
  it('loads the ductum profile and renders a valid 3-stage workflow', () => {
    const profile = loadWorkflowProfile(profilePath)
    const rendered = renderWorkflow(templatePath, profile, { repoRoot })
    const definition = loadWorkflowString(rendered)

    expect(definition.stages.map((s) => s.id)).toEqual([
      'understand', 'implement', 'ship', 'done',
    ])

    const understand = definition.stages.find((s) => s.id === 'understand')
    expect(understand?.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash'])
    // Only required_files generate exit gates
    expect(understand?.exit).toHaveLength(2)
    expect(understand?.exit.map((g) => g.message)).toEqual([
      'Read README.md before editing',
      'Read CLAUDE.md before editing',
    ])

    const implement = definition.stages.find((s) => s.id === 'implement')
    expect(implement?.tools).toContain('Edit')
    expect(implement?.tools).toContain('Write')
    // No exit gates — factory controls advancement via advanceToStage
    // Checks block disallowed commands (e.g., git push) before auto-advance (@edictum/core 0.4.2+)
    expect(implement?.exit).toHaveLength(0)

    const ship = definition.stages.find((s) => s.id === 'ship')
    expect(ship?.checks[0]?.commandMatches).toContain('git\\s+status')
    expect(ship?.exit.length).toBeGreaterThan(0)
    expect(ship?.approval?.message).toBe('Approve only after external review reports no new issues')
  })

  it('renders read exit gates from required files only, skips missing optional files', () => {
    const tempRepo = createTempRepo(['README.md', 'CLAUDE.md'])
    const profile = parseWorkflowProfile(
      `
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: temp
context:
  required_files: [README.md, CLAUDE.md]
  optional_files: [AGENTS.md]
verify:
  commands: [pnpm lint, pnpm test]
push:
  protected_branches: [main]
  allowed_git_commands: [git status, git commit]
`,
      'inline-profile',
    )

    const rendered = renderWorkflow(templatePath, profile, { repoRoot: tempRepo })
    const definition = loadWorkflowString(rendered)
    const understand = definition.stages.find((s) => s.id === 'understand')

    expect(rendered).not.toContain('AGENTS.md')
    expect(understand?.exit).toHaveLength(2)
    expect(understand?.exit.map((g) => g.message)).toEqual([
      'Read README.md before editing',
      'Read CLAUDE.md before editing',
    ])
  })

  it('does not create exit gates for optional files even when they exist on disk', () => {
    const tempRepo = createTempRepo(['README.md', 'CLAUDE.md', 'AGENTS.md'])
    const profile = parseWorkflowProfile(
      `
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: optional-test
context:
  required_files: [README.md, CLAUDE.md]
  optional_files: [AGENTS.md]
verify:
  commands: [pnpm test]
push:
  protected_branches: [main]
  allowed_git_commands: [git status, git commit]
`,
      'optional-test',
    )

    const rendered = renderWorkflow(templatePath, profile, { repoRoot: tempRepo })
    const definition = loadWorkflowString(rendered)
    const understand = definition.stages.find((s) => s.id === 'understand')

    expect(understand?.exit).toHaveLength(2)
    expect(understand?.exit.map((g) => g.message)).toEqual([
      'Read README.md before editing',
      'Read CLAUDE.md before editing',
    ])
  })

  it('includes verify commands in ship stage allowed pattern', () => {
    const tempRepo = createTempRepo(['README.md'])
    const profile = parseWorkflowProfile(
      `
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: verify-in-ship
context:
  required_files: [README.md]
verify:
  commands: [pnpm build, pnpm test]
push:
  protected_branches: [main, production]
  allowed_git_commands: [git status, git add, git commit, git push]
`,
      'verify-in-ship',
    )

    const rendered = renderWorkflow(templatePath, profile, { repoRoot: tempRepo })
    const definition = loadWorkflowString(rendered)
    const ship = definition.stages.find((s) => s.id === 'ship')

    // Ship should allow git commands, gh pr, AND verify commands (pnpm build, pnpm test)
    expect(ship?.checks[0]?.commandMatches).toContain('pnpm\\s+build')
    expect(ship?.checks[0]?.commandMatches).toContain('pnpm\\s+test')
    expect(ship?.checks[0]?.commandMatches).toContain('git\\s+push')
    // Protected branch pattern should include both main and production
    expect(ship?.checks[1]?.commandNotMatches).toContain('main|production')
  })

  it('renders a custom ship approval message from the workflow profile', () => {
    const tempRepo = createTempRepo(['README.md'])
    const profile = parseWorkflowProfile(
      `
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: approval-message
context:
  required_files: [README.md]
verify:
  commands: [pnpm test]
review:
  approval_message: Human approves after review and CI
push:
  protected_branches: [main]
  allowed_git_commands: [git status, git add, git commit, git push]
`,
      'approval-message',
    )

    const rendered = renderWorkflow(templatePath, profile, { repoRoot: tempRepo })
    const definition = loadWorkflowString(rendered)
    const ship = definition.stages.find((s) => s.id === 'ship')

    expect(ship?.approval?.message).toBe('Human approves after review and CI')
  })

  it('parses explicit unattended approval policy', () => {
    const profile = parseWorkflowProfile(`
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: guarded
context:
  required_files: [README.md]
verify:
  commands: [pnpm test]
push:
  protected_branches: [main]
  allowed_git_commands: [git status, git push]
unattended:
  auto_approve: true
  auto_merge: true
  auto_push: false
  push_requires: local_verify
`)

    expect(profile.unattended).toEqual({
      auto_approve: true,
      auto_merge: true,
      auto_push: false,
      push_requires: 'local_verify',
    })
  })

  it('renders the ductum profile with main reserved as a protected branch', () => {
    const profile = loadWorkflowProfile(profilePath)
    const rendered = renderWorkflow(templatePath, profile, { repoRoot })
    const definition = loadWorkflowString(rendered)
    const implement = definition.stages.find((s) => s.id === 'implement')
    const ship = definition.stages.find((s) => s.id === 'ship')

    expect(profile.push.protected_branches).toEqual(['main'])
    expect(implement?.checks[0]?.message).toBe('Push belongs in ship stage')
    expect(implement?.checks[1]?.commandNotMatches).toContain('(?:main)')
    expect(ship?.checks[1]?.commandNotMatches).toContain('(?:main)')
  })

  it('fails fast when a required profile file is missing', () => {
    const tempRepo = createTempRepo(['README.md'])
    const profile = parseWorkflowProfile(
      `
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: broken
context:
  required_files: [README.md, CLAUDE.md]
verify:
  commands: [pnpm test]
push:
  protected_branches: [main]
`,
      'missing-required',
    )

    expect(() => renderWorkflow(templatePath, profile, { repoRoot: tempRepo })).toThrow(
      'Required workflow profile file not found: CLAUDE.md',
    )
  })
})
