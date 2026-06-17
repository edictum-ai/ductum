import { randomBytes } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FactoryOperatorTokenResult {
  token: string
  tokenPath: string
  envPath: string
}

export function mintOperatorToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function writeFactoryOperatorToken(projectDir: string): Promise<FactoryOperatorTokenResult> {
  const token = mintOperatorToken()
  const tokenPath = join(projectDir, '.ductum', 'operator-token')
  const envPath = join(projectDir, '.env.local')
  await writePrivateFile(tokenPath, `${token}\n`)
  await writePrivateFile(envPath, `DUCTUM_OPERATOR_TOKEN=${token}\n`)
  return { token, tokenPath, envPath }
}

async function writePrivateFile(path: string, text: string): Promise<void> {
  await writeFile(path, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await chmod(path, 0o600)
}
