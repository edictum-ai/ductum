import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIREMENTS = [
  {
    file: 'AGENTS.md',
    markers: [
      'Stage residuals must be pinned before the stage closes',
      'Prose-only acknowledgment is not a pin',
    ],
  },
  {
    file: 'decisions/185-residuals-pinned-before-close.md',
    markers: [
      '# D185 - Stage residuals must be pinned before a stage closes',
      'A residual is pinned when it has at least one of',
      'decisions/<NNN>-*.md',
    ],
  },
  {
    file: '.agents/skills/ductum-spec-authoring/SKILL.md',
    markers: [
      'Residual pinning',
      'A stage may close with residuals only when each residual is pinned',
      'decisions/185-residuals-pinned-before-close.md',
    ],
  },
]

export function checkResidualsPinned({ root = repoRoot() } = {}) {
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

export function formatResidualsPinnedReport(result) {
  if (result.violations.length === 0) return 'residual pinning guard passed'
  return [
    'residual pinning guard failed',
    ...result.violations.map((item) => `- ${item.file} is missing ${JSON.stringify(item.marker)} (${item.reason})`),
    'Stage residuals need a named fix, a test pinning current behavior, or a decisions/ reference before the stage closes.',
  ].join('\n')
}

function repoRoot() {
  return fileURLToPath(new URL('..', import.meta.url))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkResidualsPinned()
  const report = formatResidualsPinnedReport(result)
  if (result.violations.length > 0) {
    console.error(report)
    process.exit(1)
  }
  console.log(report)
}
