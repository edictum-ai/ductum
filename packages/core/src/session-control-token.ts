import { randomBytes } from 'node:crypto'

export function createSessionControlToken(): string {
  return randomBytes(32).toString('hex')
}
