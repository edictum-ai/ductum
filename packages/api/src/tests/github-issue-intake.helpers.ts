import { vi } from 'vitest'

export function stubIssueFetch(input: {
  number?: number
  title?: string
  body: string
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
        labels: [{ name: 'needs-triage' }, { name: 'P1' }],
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

export function issueFormBody(input: { includeSafety?: boolean } = {}) {
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
    'pnpm build',
    'pnpm test',
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
