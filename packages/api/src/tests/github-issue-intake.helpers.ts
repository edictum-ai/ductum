import { vi } from 'vitest'

export function stubIssueFetch(input: {
  number?: number
  title?: string
  body: string
  labels?: Array<{ name: string }>
  comments: Array<{ id: number; html_url: string; body: string }>
}): ReturnType<typeof vi.fn> {
  const number = input.number ?? 12
  const title = input.title ?? 'core: imported issue'
  return vi.fn(async (url: string) => {
    if (url.endsWith(`/repos/edictum-ai/ductum/issues/${number}`)) {
      return jsonResponse({
        number,
        html_url: `https://github.com/edictum-ai/ductum/issues/${number}`,
        title,
        body: input.body,
        labels: input.labels ?? [{ name: 'needs-triage' }, { name: 'P1' }],
      })
    }
    if (url.endsWith(`/repos/edictum-ai/ductum/issues/${number}/comments`)) {
      return jsonResponse(input.comments)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export function issueFormBody(input: {
  includeSafety?: boolean
  verificationCommands?: string[]
} = {}) {
  return [
    '### Work type',
    'feature',
    '',
    '### Priority',
    'P1 - blocks unattended/prod readiness',
    '',
    '### Area',
    'core',
    '',
    '### Blockers',
    '- [x] Blocks unattended operation',
    '',
    '### Objective',
    'After this work, Ductum should import issue-form tasks.',
    '',
    '### Evidence and source refs',
    '- packages/api/src/routes/issues.ts',
    '- failing operator report',
    '',
    '### Requirements',
    '- Must preserve GitHub source metadata.',
    '- Must reject missing required fields.',
    '',
    '### Out of scope',
    '- Do not close the issue.',
    '',
    '### Acceptance criteria',
    '- [ ] Imported task carries source provenance.',
    '- [ ] Missing required fields fail loudly.',
    '',
    '### Verification commands',
    ...(input.verificationCommands ?? ['pnpm build', 'pnpm test']),
    '',
    ...(input.includeSafety === false
      ? []
      : [
        '### Safety and rollback notes',
        '- No destructive commands.',
        '',
      ]),
    '### Suggested branch',
    'feat/github-issue-intake-auth',
    '',
    '### Ductum executor hints',
    'Suggested builder: codex',
  ].join('\n')
}

export function legacyIssueBody(input: {
  problem?: string
  desiredOutcome?: string
  expectedFix?: string
  acceptance?: string[]
} = {}) {
  const outcomeHeading = input.expectedFix == null ? '## Desired outcome' : '## Expected fix'
  const outcome = input.expectedFix
    ?? input.desiredOutcome
    ?? 'Import legacy migrated issues directly from GitHub without requiring repo-local spec bridge files or manual prompt rewrites.'
  return [
    '## Problem',
    input.problem ?? 'Native GitHub issue intake fails on migrated backlog issues that still use the legacy markdown shape.',
    '',
    outcomeHeading,
    outcome,
    '',
    '## Acceptance',
    ...(input.acceptance ?? [
      '- [ ] `ductum issue intake ductum 32` succeeds for a legacy migrated issue.',
      '- [ ] Imported tasks still have an executable prompt and default verification commands.',
    ]),
  ].join('\n')
}
