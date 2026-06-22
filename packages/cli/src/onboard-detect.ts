import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

export interface OnboardDetection {
  stack: string
  projectName: string
  requiredFiles: string[]
  optionalFiles: string[]
  setupCommands: string[]
  verifyCommands: string[]
}

export interface OnboardDetectionOptions {
  projectName?: string
  setupCommands?: string[]
  verifyCommands?: string[]
  requiredFiles?: string[]
}

export function detectOnboardProject(repoPath: string, options: OnboardDetectionOptions = {}): OnboardDetection {
  const stack = detectStack(repoPath)
  const requiredFiles = nonEmpty(options.requiredFiles) ?? defaultRequiredFiles(repoPath)
  const verifyCommands = nonEmpty(options.verifyCommands) ?? defaultVerifyCommands(repoPath, stack)
  const setupCommands = nonEmpty(options.setupCommands) ?? defaultSetupCommands(repoPath, stack)
  if (requiredFiles.length === 0) throw new Error('onboard requires at least one required file')
  if (verifyCommands.length === 0) throw new Error('onboard requires at least one verify command')
  return {
    stack,
    projectName: options.projectName ?? basename(repoPath),
    requiredFiles,
    optionalFiles: existingOptionalFiles(repoPath),
    setupCommands,
    verifyCommands,
  }
}

function detectStack(repoPath: string): string {
  if (exists(repoPath, 'package.json')) return 'node'
  if (exists(repoPath, 'go.mod')) return 'go'
  if (exists(repoPath, 'Cargo.toml')) return 'rust'
  if (exists(repoPath, 'pyproject.toml')) return 'python'
  return 'generic'
}

function defaultRequiredFiles(repoPath: string): string[] {
  for (const file of ['README.md', 'AGENTS.md', 'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml']) {
    if (exists(repoPath, file)) return [file]
  }
  return ['.gitignore'].filter((file) => exists(repoPath, file))
}

function defaultSetupCommands(repoPath: string, stack: string): string[] {
  if (stack === 'node' && exists(repoPath, 'pnpm-lock.yaml')) return ['pnpm install --frozen-lockfile']
  if (stack === 'node' && exists(repoPath, 'package-lock.json')) return ['npm ci']
  return []
}

function defaultVerifyCommands(repoPath: string, stack: string): string[] {
  if (stack === 'node') return nodeVerifyCommands(repoPath)
  if (stack === 'go') return ['go test ./...']
  if (stack === 'rust') return ['cargo test']
  if (stack === 'python') return ['python -m pytest']
  return ['git status --short']
}

function nodeVerifyCommands(repoPath: string): string[] {
  const scripts = readPackageScripts(repoPath)
  if (scripts.has('test')) return ['pnpm test']
  if (scripts.has('build')) return ['pnpm build']
  return ['node --check package.json']
}

function readPackageScripts(repoPath: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(`${repoPath}/package.json`, 'utf8')) as { scripts?: Record<string, unknown> }
    return new Set(Object.entries(pkg.scripts ?? {}).filter(([, value]) => typeof value === 'string').map(([key]) => key))
  } catch {
    return new Set()
  }
}

function existingOptionalFiles(repoPath: string): string[] {
  return ['AGENTS.md', 'CLAUDE.md', 'docs/SETUP.md'].filter((file) => exists(repoPath, file))
}

function exists(repoPath: string, file: string): boolean {
  return existsSync(`${repoPath}/${file}`)
}

function nonEmpty(values: string[] | undefined): string[] | undefined {
  const filtered = values?.filter(Boolean)
  return filtered == null || filtered.length === 0 ? undefined : filtered
}
