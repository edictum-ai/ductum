import type { Context } from 'hono'

import { ValidationError } from './errors.js'

export async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch (error) {
    throw error instanceof Error ? new ValidationError(error.message) : error
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`)
  }
  return value
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`)
  }
  return value
}

export function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  const list = requireArray(value, field)
  if (!list.every((item) => typeof item === 'string')) {
    throw new ValidationError(`${field} must be an array of strings`)
  }
  return list
}

export function optionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`)
  }
  return value
}

export function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError(`${field} must be a number`)
  }
  return value
}
