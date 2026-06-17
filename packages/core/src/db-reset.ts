import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

export function resetDb(dbPath: string): void {
  if (dbPath === ':memory:') {
    return
  }

  const resolvedPath = resolve(dbPath)
  for (const filePath of [resolvedPath, `${resolvedPath}-shm`, `${resolvedPath}-wal`]) {
    rmSync(filePath, { force: true })
  }
}
