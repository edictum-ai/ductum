import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRODUCERS = [
  evidence(
    'repositoryReadiness',
    'packages/core/src/repository-model.ts',
    'packages/core/src/tests/repository-model.test.ts',
    'produces failing-path readiness states for repositories without remote or GitHub support',
  ),
  evidence(
    'buildReadinessRepairItems',
    'packages/core/src/repair-readiness.ts',
    'packages/core/src/tests/repair-readiness-states.test.ts',
    'turns a failed local app check into a repair item',
  ),
  evidence(
    'buildExecutionRepairItems',
    'packages/core/src/repair-execution.ts',
    'packages/core/src/tests/repair-execution.test.ts',
    'turns execution integrity failures into attempt recovery repair items',
  ),
  evidence(
    'buildFactoryDoctorReport',
    'packages/core/src/factory-doctor.ts',
    'packages/core/src/tests/factory-doctor.test.ts',
    'blocks a GLM/Z.AI Claude route when the real builder sees a non-Z.AI Anthropic base URL',
  ),
]

export function checkReadinessFailingPaths({ root = repoRoot(), producers = PRODUCERS } = {}) {
  const violations = []
  for (const producer of producers) {
    const text = read(join(root, producer.testFile))
    if (text == null) {
      violations.push({ producer: producer.name, source: producer.source, testFile: producer.testFile, reason: 'missing test file' })
      continue
    }
    if (!text.includes(producer.pattern)) {
      violations.push({
        producer: producer.name,
        source: producer.source,
        testFile: producer.testFile,
        reason: `missing ${producer.mode} evidence: "${producer.pattern}"`,
      })
    }
  }
  return { checked: producers.length, violations }
}

export function formatReadinessFailingPathReport(result) {
  if (result.violations.length === 0) return 'readiness failing-path guard passed'
  return [
    'readiness failing-path guard failed',
    ...result.violations.map((item) =>
      `- ${item.producer} (${item.source}) -> ${item.testFile}: ${item.reason}`,
    ),
    'Add a failing-path test, or mark the producer asserted-only in the inventory.',
  ].join('\n')
}

function evidence(name, source, testFile, pattern) {
  return { name, source, testFile, pattern, mode: 'failing-path' }
}

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
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
