import { randomBytes } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FactorySecretKeyResult {
  keyPath: string
}

export async function writeFactorySecretKey(projectDir: string): Promise<FactorySecretKeyResult> {
  const keyPath = join(projectDir, '.ductum', 'secrets.key')
  await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })
  await chmod(keyPath, 0o600)
  return { keyPath }
}
