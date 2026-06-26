import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createId, encryptFactorySecret, formatFactorySecretRef, loadFactorySecretKey } from '@ductum/core'
import type { TestFixture } from './helpers.js'
import { seedBase } from './helpers.js'

export function setupGitHubIssueFixture(
  fixture: TestFixture,
  options: {
    run?: Partial<{
      branch: string | null
      commitSha: string | null
      prNumber: number | null
      prUrl: string | null
      ciStatus: 'pass' | 'fail' | 'pending' | null
    }>
    verification?: string[]
  } = {},
) {
  const { project, builder } = seedBase(fixture)
  const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-gh-app-'))
  mkdirSync(join(factoryDir, '.ductum'), { recursive: true })
  writeFileSync(join(factoryDir, '.ductum', 'secrets.key'), randomBytes(32), { mode: 0o600 })
  chmodSync(join(factoryDir, '.ductum', 'secrets.key'), 0o600)
  const loadedKey = loadFactorySecretKey(factoryDir)
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey
  const encrypted = encryptFactorySecret(JSON.stringify({
    mode: 'github_app',
    appId: '123',
    installationId: '456',
    privateKey,
  }), loadedKey)
  fixture.repos.secrets.create({
    id: 'github-app',
    name: 'github-app',
    scope: 'project',
    projectId: project.id,
    description: null,
    status: 'configured',
    keySource: encrypted.keySource,
    payload: encrypted.payload,
    lastRotatedAt: null,
    lastTestedAt: null,
  })

  const repository = fixture.repos.repositories.create({
    id: createId<'RepositoryId'>() as never,
    projectId: project.id,
    name: 'ductum',
    spec: {
      remoteUrl: 'https://github.com/edictum-ai/ductum.git',
      authRef: formatFactorySecretRef('github-app'),
    },
  })
  const source = {
    kind: 'github-issue' as const,
    provider: 'github' as const,
    repoOwner: 'edictum-ai',
    repoName: 'ductum',
    issueNumber: 12,
    issueUrl: 'https://github.com/edictum-ai/ductum/issues/12',
    title: 'core: imported issue',
    labels: ['needs-triage'],
    importedAt: '2026-06-23T12:00:00.000Z',
    formId: 'ductum-work-item' as const,
    parsed: {
      workType: 'feature',
      priority: 'P1 - blocks unattended/prod readiness',
      area: 'core',
      blockers: [],
      objective: 'Import GitHub issues.',
      evidence: ['issue body'],
      requirements: ['Persist provenance'],
      outOfScope: ['Do not merge'],
      acceptanceCriteria: ['PR created'],
      verificationCommands: options.verification ?? ['pnpm test'],
      safetyNotes: ['No destructive commands.'],
      suggestedBranch: 'feat/github-issue-intake-auth',
    },
  }
  const spec = fixture.repos.specs.create({
    id: createId<'SpecId'>(),
    projectId: project.id,
    name: 'core: imported issue',
    status: 'approved',
    document: '# imported',
    source,
  })
  const task = fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    repositoryId: repository.id,
    targetId: null,
    componentId: null,
    name: 'core: imported issue',
    prompt: 'implement',
    repos: ['packages/core'],
    source,
    assignedAgentId: builder.id,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    verification: options.verification ?? ['pnpm test'],
  })
  const run = fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: builder.id,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: options.run?.branch ?? null,
    commitSha: options.run?.commitSha ?? null,
    prNumber: options.run?.prNumber ?? null,
    prUrl: options.run?.prUrl ?? null,
    worktreePaths: ['/tmp/worktree'],
    ciStatus: options.run?.ciStatus ?? null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  })
  return { factoryDir, run }
}
