import type { RunLatchStatus } from '../types.js'
import type { SqliteDatabase } from '../db.js'

export type { SqliteDatabase }

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

export function assertChanges(changes: number, message: string): void {
  if (changes === 0) {
    throw new Error(message)
  }
}

export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

export function parseOptionalJson<T>(value: string | null): T | null {
  return value == null ? null : (JSON.parse(value) as T)
}

export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

export function toIsoString(value: string | null): string | null {
  if (value == null || value.includes('T')) {
    return value
  }
  return `${value.replace(' ', 'T')}Z`
}

export function toBoolean(value: number): boolean {
  return value === 1
}

export function fromBoolean(value: boolean): number {
  return value ? 1 : 0
}

export function toRunLatchStatus(value: string | null): RunLatchStatus | null {
  return value as RunLatchStatus | null
}
