import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPORTISH_NAME = /(brief|report|summary|receipt|status)/i
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/
const DEFAULT_LIMIT_PATTERNS = [
  { name: 'repos.runs.listAll', regex: /\.runs\.listAll\(([\s\S]*?)\)/g },
  { name: 'api.listAttempts', regex: /\.listAttempts\(([\s\S]*?)\)/g },
  { name: 'api.listAllRuns', regex: /\.listAllRuns\(([\s\S]*?)\)/g },
]

export function checkCountQueries({ root = repoRoot() } = {}) {
  const violations = []
  for (const file of listFiles(root)) {
    if (!REPORTISH_NAME.test(file)) continue
    const text = readFileSync(join(root, file), 'utf8')
    for (const pattern of DEFAULT_LIMIT_PATTERNS) {
      for (const match of text.matchAll(pattern.regex)) {
        const args = (match[1] ?? '').trim()
        if (args !== '' && /\blimit\s*:/.test(args)) continue
        violations.push({
          file,
          line: lineNumber(text, match.index ?? 0),
          pattern: pattern.name,
        })
      }
    }
  }
  return { scanned: violations.length, violations }
}

export function formatCountQueryReport(result) {
  if (result.violations.length === 0) return 'count-query guard passed'
  return [
    'count-query guard failed',
    ...result.violations.map((item) =>
      `- ${item.file}:${item.line} uses ${item.pattern} without an explicit limit in a summary/report surface`,
    ),
    'Use COUNT(*) / an explicit count API for counts, or pass an explicit limit for a real list surface.',
  ].join('\n')
}

function repoRoot() {
  return fileURLToPath(new URL('..', import.meta.url))
}

function listFiles(root, dir = root) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(root, full))
      continue
    }
    const rel = relative(root, full).replaceAll('\\', '/')
    if (SOURCE_EXT.test(rel)) files.push(rel)
  }
  return files
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split('\n').length
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkCountQueries()
  const report = formatCountQueryReport(result)
  if (result.violations.length > 0) {
    console.error(report)
    process.exit(1)
  }
  console.log(report)
}
