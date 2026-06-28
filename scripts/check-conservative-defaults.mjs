import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIREMENTS = [
  {
    file: 'AGENTS.md',
    markers: [
      'Conservative defaults for new records',
      '`mergeMode` defaults to `human`',
      'never `auto`',
      'unattended approval',
      'stay blocked unless the workflow profile explicitly allows',
    ],
  },
  {
    file: 'decisions/185-conservative-defaults.md',
    markers: [
      '# D185 — Conservative defaults for new records',
      'Merge mode defaults to `human`',
      'Dispatch defaults to off',
      'Approval defaults to required',
      'Silent regressions are not acceptable',
    ],
  },
  {
    file: 'packages/api/src/routes/projects.ts',
    markers: [
      "config.mergeMode === 'auto' ? 'auto' : 'human'",
    ],
  },
  {
    file: 'packages/core/src/factory-seed.ts',
    markers: [
      "mergeMode: 'human'",
      'D185: conservative default',
    ],
  },
  {
    file: 'packages/api/src/tests/conservative-defaults.test.ts',
    markers: [
      "defaults project mergeMode to human when the request omits it",
      "falls back to human mergeMode when the request supplies an unrecognized value",
      "only opts in to auto mergeMode with an explicit auto value",
      "preserves an explicit auto opt-in on update but never relaxes to auto implicitly",
    ],
  },
  {
    file: 'packages/core/src/tests/factory-seed.test.ts',
    markers: [
      "seeds the initial project with the D185 conservative mergeMode default",
      "toBe('human')",
    ],
  },
  {
    file: 'packages/core/src/tests/unattended-approval-policy.test.ts',
    markers: [
      'keeps manual approval as default by blocking absent workflow policy',
      'workflow does not define unattended approval policy',
    ],
  },
]

export function checkConservativeDefaults({ root = repoRoot() } = {}) {
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
      if (!text.includes(marker)) {
        violations.push({ file: requirement.file, marker, reason: 'missing marker' })
      }
    }
  }
  return { checked: REQUIREMENTS.length, violations }
}

export function formatConservativeDefaultsReport(result) {
  if (result.violations.length === 0) return 'conservative-defaults guard passed'
  return [
    'conservative-defaults guard failed',
    ...result.violations.map((item) =>
      `- ${item.file} is missing ${JSON.stringify(item.marker)} (${item.reason})`,
    ),
    'New merge/dispatch/approval defaults must stay protective (human merge, dispatch off, approval required). See decisions/185-conservative-defaults.md.',
  ].join('\n')
}

function repoRoot() {
  return fileURLToPath(new URL('..', import.meta.url))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkConservativeDefaults()
  const report = formatConservativeDefaultsReport(result)
  if (result.violations.length > 0) {
    console.error(report)
    process.exit(1)
  }
  console.log(report)
}
