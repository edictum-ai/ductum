import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIREMENTS = [
  {
    file: 'AGENTS.md',
    markers: [
      'Readiness/repair producers must have failing-path coverage before they',
      'become readiness gates',
      'remove it or mark it',
      'as asserted instead of presenting it as proof',
    ],
  },
  {
    file: 'decisions/184-no-always-green-readiness-checks.md',
    markers: [
      '# D184 - Readiness checks need failing-path proof',
      'Every readiness or repair producer that can block operator trust must have at',
      'least one failing-path test before it ships',
    ],
  },
  {
    file: 'packages/core/src/tests/repair-readiness-states.test.ts',
    markers: [
      'covers failed readiness producers with repair items',
      'factory:dispatcher-disabled',
      'host:git:missing',
      'factory:data-dir:writable',
      'factory:local-app-port',
      'attempt-recovery:needs-operator',
      'provider:anthropic:auth:missing',
      'local-git:missing',
      'github-auth:missing',
    ],
  },
  {
    file: 'packages/api/src/tests/repair.routes.test.ts',
    markers: [
      'reports missing remote and GitHub auth before Attempt start',
      'rejects legacy accept before Attempt start when prerequisites fail',
      'fails accept closed when dispatch prerequisite context is missing',
    ],
  },
  {
    file: 'packages/core/src/tests/repair-workflow-validity.test.ts',
    markers: [
      'targets the validity blocker at the referencing project and keeps siblings eligible',
      'keeps ambiguous legacy workflowProfile names unresolved instead of picking one record',
    ],
  },
]

export function checkReadinessFailingPaths({ root = repoRoot() } = {}) {
  const violations = []
  for (const requirement of REQUIREMENTS) {
    let text = ''
    try {
      text = readFileSync(join(root, requirement.file), 'utf8')
    } catch (error) {
      violations.push({ file: requirement.file, marker: '<file>', reason: String(error) })
      continue
    }
    for (const marker of requirement.markers) {
      if (!text.includes(marker)) violations.push({ file: requirement.file, marker, reason: 'missing marker' })
    }
  }
  return { checked: REQUIREMENTS.length, violations }
}

export function formatReadinessFailingPathReport(result) {
  if (result.violations.length === 0) return 'readiness failing-path guard passed'
  return [
    'readiness failing-path guard failed',
    ...result.violations.map((item) => `- ${item.file} is missing ${JSON.stringify(item.marker)} (${item.reason})`),
    'Readiness/repair producers need a named failing-path test or a decision that marks the check asserted instead of verified.',
  ].join('\n')
}

function repoRoot() {
  return fileURLToPath(new URL('..', import.meta.url))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkReadinessFailingPaths()
  const report = formatReadinessFailingPathReport(result)
  if (result.violations.length > 0) {
    console.error(report)
    process.exit(1)
  }
  console.log(report)
}
