import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliVersionEnvelope {
  schemaVersion: 1
  kind: 'cli.version'
  data: { version: string; packageName: string }
  ts: string
}

export function readCliVersion(startUrl = import.meta.url): string {
  return readCliPackage(startUrl).version
}

export function createCliVersionEnvelope(version = readCliVersion(), now = () => new Date()): CliVersionEnvelope {
  return {
    schemaVersion: 1,
    kind: 'cli.version',
    data: { version, packageName: readCliPackage().name },
    ts: now().toISOString(),
  }
}

function readCliPackage(startUrl = import.meta.url): { name: string; version: string } {
  const found = findPackageJson(dirname(fileURLToPath(startUrl)))
  if (found == null) return { name: 'ductum', version: '0.0.0-dev' }
  try {
    const parsed = JSON.parse(readFileSync(found, 'utf8')) as { name?: unknown; version?: unknown }
    const name = typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : 'ductum'
    const version = typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0-dev'
    return { name, version }
  } catch {
    return { name: 'ductum', version: '0.0.0-dev' }
  }
}

function findPackageJson(startDir: string): string | null {
  let current = startDir
  while (true) {
    const candidate = join(current, 'package.json')
    if (existsSync(candidate)) return candidate
    const next = dirname(current)
    if (next === current) return null
    current = next
  }
}
