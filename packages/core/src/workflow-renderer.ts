import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { loadWorkflowString, type WorkflowDefinition } from '@edictum/core'
import { parse } from 'yaml'

const DEFAULT_APPROVAL_MESSAGE = 'Approve only after external review reports no new issues'
const DEFAULT_PROTECTED_BRANCHES = ['main']
const DEFAULT_ALLOWED_GIT_COMMANDS = ['git status', 'git diff', 'git add', 'git commit']
const DEFAULT_ALLOWED_PR_COMMANDS = ['gh pr view', 'gh pr status']
const BLOCKED_SHIP_COMMAND_RE =
  /^(?:git\s+push|gh\s+(?:pr\s+(?:checkout|close|comment|create|edit|lock|merge|ready|reopen|review|unlock)|issue\s+(?:close|comment|create|delete|develop|edit|lock|pin|reopen|transfer|unlock|unpin)))\b/i

export interface RepoWorkflowProfile {
  apiVersion: string
  kind: string
  metadata: { name: string; description?: string }
  context: { required_files: string[]; optional_files: string[] }
  setup?: { commands: string[] }
  verify: { commands: string[] }
  review?: { approval_message?: string }
  push: { protected_branches: string[]; allowed_git_commands: string[] }
  unattended?: {
    auto_approve: boolean
    auto_merge: boolean
    auto_push: boolean
    push_requires: 'remote_ci' | 'local_verify'
  }
}

export interface RenderedWorkflowProfile {
  profile: RepoWorkflowProfile
  renderedWorkflow: string
  definition: WorkflowDefinition
}

export function loadWorkflowProfile(profilePath: string): RepoWorkflowProfile {
  return parseWorkflowProfile(readFileSync(profilePath, 'utf8'), profilePath)
}

export function parseWorkflowProfile(raw: string, source = 'workflow profile'): RepoWorkflowProfile {
  const value = parse(raw)
  const root = expectRecord(value, source)
  const metadata = expectRecord(root['metadata'], `${source}.metadata`)
  const context = expectRecord(root['context'], `${source}.context`)
  const setup = optionalRecord(root['setup'], `${source}.setup`)
  const verify = expectRecord(root['verify'], `${source}.verify`)
  const review = optionalRecord(root['review'], `${source}.review`)
  const push = expectRecord(root['push'], `${source}.push`)
  const unattended = optionalRecord(root['unattended'], `${source}.unattended`)
  const requiredFiles = expectStringArray(context['required_files'], `${source}.context.required_files`)
  const verifyCommands = expectStringArray(verify['commands'], `${source}.verify.commands`)

  if (requiredFiles.length === 0) {
    throw new Error(`${source}.context.required_files must contain at least one file`)
  }
  if (verifyCommands.length === 0) {
    throw new Error(`${source}.verify.commands must contain at least one command`)
  }

  return {
    apiVersion: expectLiteral(root['apiVersion'], 'edictum/v1alpha1', `${source}.apiVersion`),
    kind: expectLiteral(root['kind'], 'WorkflowProfile', `${source}.kind`),
    metadata: {
      name: expectString(metadata['name'], `${source}.metadata.name`),
      description: optionalString(metadata['description'], `${source}.metadata.description`),
    },
    context: {
      required_files: requiredFiles,
      optional_files:
        optionalStringArray(context['optional_files'], `${source}.context.optional_files`) ?? [],
    },
    setup:
      setup == null
        ? undefined
        : { commands: optionalStringArray(setup['commands'], `${source}.setup.commands`) ?? [] },
    verify: { commands: verifyCommands },
    review:
      review == null
        ? undefined
        : { approval_message: optionalString(review['approval_message'], `${source}.review.approval_message`) },
    push: {
      protected_branches:
        optionalStringArray(push['protected_branches'], `${source}.push.protected_branches`) ||
        [...DEFAULT_PROTECTED_BRANCHES],
      allowed_git_commands:
        optionalStringArray(push['allowed_git_commands'], `${source}.push.allowed_git_commands`) ||
        [...DEFAULT_ALLOWED_GIT_COMMANDS],
    },
    unattended: unattended == null ? undefined : {
      auto_approve: expectBoolean(unattended['auto_approve'], `${source}.unattended.auto_approve`),
      auto_merge: expectBoolean(unattended['auto_merge'], `${source}.unattended.auto_merge`),
      auto_push: expectBoolean(unattended['auto_push'], `${source}.unattended.auto_push`),
      push_requires: expectOneOf(
        unattended['push_requires'],
        ['remote_ci', 'local_verify'] as const,
        `${source}.unattended.push_requires`,
      ),
    },
  }
}

export function resolveWorkflowProfileRepoRoot(profilePath: string): string {
  return resolve(dirname(profilePath), '..')
}

export function renderWorkflow(
  templatePath: string,
  profile: RepoWorkflowProfile,
  options: { repoRoot?: string } = {},
): string {
  const template = readFileSync(templatePath, 'utf8')
  const protectedBranches = uniqueStrings(
    profile.push.protected_branches.length > 0
      ? profile.push.protected_branches
      : DEFAULT_PROTECTED_BRANCHES,
  )
  const verifyCommands = uniqueStrings(profile.verify.commands)
  const allowedPushCommands = uniqueStrings(
    profile.push.allowed_git_commands.length > 0
      ? profile.push.allowed_git_commands
      : DEFAULT_ALLOWED_GIT_COMMANDS,
  ).filter(isAllowedShipCommand)
  const shipAllowedCommands = [
    ...allowedPushCommands,
    ...DEFAULT_ALLOWED_PR_COMMANDS,
    ...verifyCommands,
  ]
  const rendered = replacePlaceholders(template, {
    READ_ANALYZE_EXIT_GATES: renderReadExitGates(profile, options.repoRoot),
    SHIP_ALLOWED_COMMANDS_PATTERN: yamlSingleQuoted(
      buildShellCommandAllowlistPattern(shipAllowedCommands),
    ),
    SHIP_APPROVAL_MESSAGE: yamlSingleQuoted(
      profile.review?.approval_message ?? DEFAULT_APPROVAL_MESSAGE,
    ),
    PUSH_PROTECTED_BRANCH_PATTERN: yamlSingleQuoted(buildProtectedBranchPushPattern(protectedBranches)),
    PUSH_PROTECTED_BRANCH_CONDITION: yamlSingleQuoted(
      `command_not_matches("${escapeConditionArg(buildProtectedBranchPushPattern(protectedBranches))}")`,
    ),
  })

  if (rendered.includes('${')) {
    throw new Error(`workflow template still contains placeholders after rendering ${templatePath}`)
  }
  return rendered
}

export function loadRenderedWorkflow(
  templatePath: string,
  profilePath: string,
): WorkflowDefinition {
  return loadRenderedWorkflowProfile(templatePath, profilePath).definition
}

export function loadRenderedWorkflowProfile(
  templatePath: string,
  profilePath: string,
): RenderedWorkflowProfile {
  const profile = loadWorkflowProfile(profilePath)
  const renderedWorkflow = renderWorkflow(templatePath, profile, {
    repoRoot: resolveWorkflowProfileRepoRoot(profilePath),
  })
  return { profile, renderedWorkflow, definition: loadWorkflowString(renderedWorkflow) }
}

function renderReadExitGates(profile: RepoWorkflowProfile, repoRoot?: string): string {
  // Only required files become mandatory exit gates.
  // Optional files are included in the prompt hint but must not block advancement.
  const requiredFiles = collectRequiredFiles(profile, repoRoot)
  return requiredFiles
    .map((file) => {
      const condition = yamlSingleQuoted(`file_read("${escapeConditionArg(file)}")`)
      const message = yamlSingleQuoted(`Read ${file} before editing`)
      return `      - condition: ${condition}\n        message: ${message}`
    })
    .join('\n')
}

function collectRequiredFiles(profile: RepoWorkflowProfile, repoRoot?: string): string[] {
  for (const file of profile.context.required_files) {
    if (repoRoot != null && !existsSync(resolve(repoRoot, file))) {
      throw new Error(`Required workflow profile file not found: ${file}`)
    }
  }
  return uniqueStrings(profile.context.required_files)
}

function buildShellCommandAllowlistPattern(commands: string[]): string {
  const commandPattern = commands
    .map((command) => `${escapeRegex(command)}(?:\\s+[^;&\\n|][^;&\\n|]*)?`)
    .join('|')
  return `^\\s*(?:${commandPattern})(?:\\s*(?:&&|\\|\\||;|\\n)\\s*(?:${commandPattern}))*\\s*$`
}

function isAllowedShipCommand(command: string): boolean {
  return !BLOCKED_SHIP_COMMAND_RE.test(command.trim())
}

function buildProtectedBranchPushPattern(branches: string[]): string {
  return `(?:^|(?:&&|\\|\\||;|\\n)\\s*)git\\s+push\\b.*(?:\\s|:)(?:${buildAlternation(branches)})(?:\\s|$)`
}

function buildAlternation(values: string[]): string {
  return values.map((value) => escapeRegex(value)).join('|')
}

function replacePlaceholders(template: string, replacements: Record<string, string>): string {
  let rendered = template
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.split(`\${${key}}`).join(value)
  }
  return rendered
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function yamlSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function escapeConditionArg(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&').replace(/\s+/g, '\\s+')
}

function expectLiteral(value: unknown, expected: string, label: string): typeof expected {
  const actual = expectString(value, label)
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}`)
  }
  return expected
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value.map((entry, index) => expectString(entry, `${label}[${index}]`))
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`)
  return value
}

function expectOneOf<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}`)
  }
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  return value == null ? undefined : expectString(value, label)
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  return value == null ? undefined : expectStringArray(value, label)
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  return value == null ? undefined : expectRecord(value, label)
}
