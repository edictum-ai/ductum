import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIREMENTS = [
  {
    file: 'docs/STAGE_RESIDUAL_PINNING.md',
    markers: [
      '# Stage Residual Pinning',
      'A stage may close with residuals only when each residual carries at least one',
      'of these pins:',
      '**Fix**',
      '**Test pinning current behavior**',
      '**Decision reference**',
      'A residual with none of these pins fails closed',
    ],
  },
  {
    file: 'decisions/185-stage-residual-pinning-directive.md',
    markers: [
      '# D185',
      'Stage residual pinning directive',
      'GitHub issue #56',
      'A stage may close with residuals only when each residual carries at least one',
      '**Decision reference**',
      'fails closed',
    ],
  },
  {
    file: 'AGENTS.md',
    markers: [
      'A stage may close with residuals only when each residual carries a fix, a',
      'test pinning current behavior, or a decision reference',
      'docs/STAGE_RESIDUAL_PINNING.md',
    ],
  },
  {
    file: 'specs/current/post-p9-hardening/README.md',
    markers: [
      'Require every stage-close residual to be pinned by a fix, a test pinning',
      'current behavior, or a decision reference',
      'Stage templates mention residual pinning',
      '## Residuals',
    ],
  },
]

export function checkStageResiduals({ root = repoRoot() } = {}) {
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

export function formatStageResidualsReport(result) {
  if (result.violations.length === 0) return 'stage residual pinning directive guard passed'
  return [
    'stage residual pinning directive guard failed',
    ...result.violations.map((item) => `- ${item.file} is missing ${JSON.stringify(item.marker)} (${item.reason})`),
    'Stage closeouts need a directive, decision, AGENTS.md rule, and stage template mention per D185.',
  ].join('\n')
}

function repoRoot() {
  return fileURLToPath(new URL('..', import.meta.url))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkStageResiduals()
  const report = formatStageResidualsReport(result)
  if (result.violations.length > 0) {
    console.error(report)
    process.exit(1)
  }
  console.log(report)
}
