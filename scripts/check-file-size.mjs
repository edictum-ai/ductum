import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MAX_LINES = 300
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

export function checkFileSizes(options = {}) {
  const root = options.root ?? process.cwd()
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const grandfatherList = readGrandfatherList(root)
  const files = findSourceFiles(join(root, 'packages'))
  const oversized = []
  const violations = []

  for (const file of files) {
    const relPath = toPosix(relative(root, file))
    const lines = countLines(readFileSync(file, 'utf-8'))
    if (lines <= maxLines) continue

    const entry = { path: relPath, lines, overBy: lines - maxLines }
    oversized.push(entry)
    if (!grandfatherList.paths.has(relPath)) violations.push(entry)
  }

  return {
    grandfatherList,
    maxLines,
    oversized,
    scanned: files.length,
    violations,
  }
}

export function findSourceFiles(startDir) {
  if (!existsSync(startDir)) return []

  const files = []
  const stack = [startDir]

  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (!entry.isFile()) continue
      if (entry.name.endsWith('.d.ts')) continue
      if (SOURCE_EXTENSIONS.has(extension(entry.name))) files.push(fullPath)
    }
  }

  return files.sort()
}

export function readGrandfatherList(root) {
  const decisionPath = findGrandfatherDecision(root)
  const paths = new Map()

  if (!decisionPath) return { path: null, paths }

  const text = readFileSync(decisionPath, 'utf-8')
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/`?(packages\/[^`|\s]+?\.(?:tsx|ts))`?/)
    if (match) paths.set(match[1], line.trim())
  }

  return { path: toPosix(relative(root, decisionPath)), paths }
}

export function findGrandfatherDecision(root) {
  const decisionsDir = join(root, 'decisions')
  if (!existsSync(decisionsDir)) return null

  return readdirSync(decisionsDir)
    .filter((name) => /^[0-9]+-file-size-grandfather-list\.md$/.test(name))
    .sort()
    .map((name) => join(decisionsDir, name))
    .at(-1) ?? null
}

export function countLines(text) {
  if (text.length === 0) return 0
  return text.split(/\r\n|\r|\n/).length - (text.endsWith('\n') ? 1 : 0)
}

function extension(fileName) {
  if (fileName.endsWith('.tsx')) return '.tsx'
  if (fileName.endsWith('.ts')) return '.ts'
  return ''
}

function toPosix(path) {
  return path.split(sep).join('/')
}

function formatReport(result) {
  const lines = []
  const listLabel = result.grandfatherList.path ?? 'no grandfather list found'

  if (result.violations.length === 0) {
    lines.push(
      `File-size gate passed: ${result.scanned} files scanned, ` +
        `${result.oversized.length} grandfathered files over ${result.maxLines} LOC.`,
    )
    lines.push(`Grandfather list: ${listLabel}`)
    return lines.join('\n')
  }

  lines.push(`File-size gate failed: ${result.violations.length} file(s) exceed ${result.maxLines} LOC.`)
  lines.push(`Grandfather list: ${listLabel}`)
  for (const violation of result.violations) {
    lines.push(`- ${violation.path}: ${violation.lines} LOC (${violation.overBy} over)`)
  }
  lines.push('Split the file or add a justified entry to the grandfather-list decision.')
  return lines.join('\n')
}

export function runCli() {
  const result = checkFileSizes()
  const report = formatReport(result)
  if (result.violations.length > 0) {
    console.error(report)
    process.exitCode = 1
    return
  }
  console.log(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
