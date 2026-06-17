import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { parseYamlSpec } from './spec-import-yaml.js'
import type { ImportedSpec, ImportedTask } from './spec-import-types.js'

export { parseYamlContent, parseYamlSpec } from './spec-import-yaml.js'
export {
  adaptSpecIntakeToImportedSpec,
  adaptWorkPackageToImportedSpec,
} from './work-package-adapter.js'
export type { ImportedSpec, ImportedTask } from './spec-import-types.js'
export type { SpecIntake, WorkPackage } from './spec-import-types.js'

export interface TableRow {
  number: number
  promptFile: string
  taskName: string
  pkg: string
  scope: string
  dependsOn: string[]
}

/**
 * Detect format from path and parse accordingly.
 * - Directory with README.md → markdown table format (--project required)
 * - .yaml/.yml file → YAML spec format (project from file)
 */
export async function parseImportPath(
  path: string,
  projectOverride?: string,
  options: { preserveYamlProject?: boolean } = {},
): Promise<ImportedSpec> {
  const resolved = resolve(path)
  const info = await stat(resolved)

  if (info.isFile() && /\.ya?ml$/i.test(resolved)) {
    return parseYamlSpec(resolved, options.preserveYamlProject === true ? undefined : projectOverride)
  }

  if (info.isDirectory()) {
    if (projectOverride == null) {
      throw new Error('--project is required when importing from a directory')
    }
    return parseMarkdownSpec(resolved, projectOverride)
  }

  throw new Error(
    `Unsupported import path: ${path} (expected a directory or .yaml/.yml file)`,
  )
}

/**
 * Parse a directory with README.md execution order table + P*.md files.
 */
export async function parseMarkdownSpec(
  dirPath: string,
  project: string,
): Promise<ImportedSpec> {
  const readmePath = join(dirPath, 'README.md')
  const readmeContent = await readFile(readmePath, 'utf8')

  const rows = parseExecutionOrderTable(readmeContent)
  if (rows.length === 0) {
    throw new Error(`No execution order table found in ${readmePath}`)
  }

  const numberToName = new Map(rows.map((row) => [row.number, row.taskName]))

  const tasks: ImportedTask[] = []
  for (const row of rows) {
    const promptPath = join(dirPath, row.promptFile)
    const prompt = await readFile(promptPath, 'utf8')

    const dependsOn = row.dependsOn
      .map((ref) => {
        const num = parsePReference(ref)
        if (num == null) return null
        const name = numberToName.get(num)
        if (name == null) {
          throw new Error(
            `Dependency "${ref}" in task "${row.taskName}" references unknown prompt #${num}`,
          )
        }
        return name
      })
      .filter((name): name is string => name != null)

    tasks.push({
      name: row.taskName,
      sourcePath: promptPath,
      prompt: prompt.trim(),
      repos: [],
      verification: [],
      dependsOn,
    })
  }

  return {
    project,
    sourcePath: dirPath,
    spec: {
      name: basename(dirPath),
      document: readmeContent,
      status: 'draft',
    },
    tasks,
  }
}

/**
 * Parse the execution order table from README.md content.
 * Expected columns: #, Prompt, Package, Scope, ..., Depends On
 */
export function parseExecutionOrderTable(content: string): TableRow[] {
  const lines = content.split('\n')
  const rows: TableRow[] = []

  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (line == null) continue
    if (/^\|.*#.*\|.*Prompt.*\|.*Depends\s+On.*\|/i.test(line)) {
      headerIndex = i
      break
    }
  }

  if (headerIndex === -1) return []

  const headerLine = lines[headerIndex] ?? ''
  const headers = splitTableRow(headerLine)
  const col = {
    number: headers.findIndex((h) => h.trim() === '#'),
    prompt: headers.findIndex((h) => /prompt/i.test(h)),
    pkg: headers.findIndex((h) => /package/i.test(h)),
    scope: headers.findIndex((h) => /scope/i.test(h)),
    dependsOn: headers.findIndex((h) => /depends\s+on/i.test(h)),
  }

  if (col.number === -1 || col.prompt === -1 || col.dependsOn === -1) return []

  // Skip separator line (|---|---|...)
  const startRow = headerIndex + 2

  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (line == null || line === '' || !line.startsWith('|')) break

    const cells = splitTableRow(line)
    const numStr = cells[col.number]?.trim()
    const promptCell = cells[col.prompt]?.trim()

    if (numStr == null || promptCell == null) continue

    const number = parseInt(numStr, 10)
    if (isNaN(number)) continue

    const promptFile = extractLinkTarget(promptCell) ?? promptCell
    const taskName = promptFile.replace(/\.md$/i, '')
    const dependsOn = parseDependsOnCell(cells[col.dependsOn]?.trim() ?? '')

    rows.push({
      number,
      promptFile,
      taskName,
      pkg: cells[col.pkg]?.trim() ?? '',
      scope: cells[col.scope]?.trim() ?? '',
      dependsOn,
    })
  }

  return rows
}

// --- Internal helpers ---

function splitTableRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|')
}

function extractLinkTarget(cell: string): string | null {
  const match = /\[([^\]]*)\]\(([^)]*)\)/.exec(cell)
  return match?.[2] ?? null
}

export function parseDependsOnCell(cell: string): string[] {
  if (cell === '' || /^[—–\-]+$/.test(cell.trim())) return []
  return cell
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref !== '')
}

function parsePReference(ref: string): number | null {
  const match = /^P(\d+)$/i.exec(ref.trim())
  return match?.[1] != null ? parseInt(match[1], 10) : null
}
