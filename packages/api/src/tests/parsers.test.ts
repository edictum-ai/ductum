import { describe, expect, it } from 'vitest'

import { ValidationError } from '../lib/errors.js'
import {
  optionalComplexity,
  optionalDependencyKind,
  optionalRequiredRole,
  optionalSpecStatus,
  optionalTaskStatus,
  parseImportedTask,
  parseSpecStatus,
  parseTaskStatus,
} from '../lib/parsers.js'

describe('lib/parsers — enum parsers', () => {
  it('parseSpecStatus accepts known values and rejects unknown', () => {
    expect(parseSpecStatus('draft', 'status')).toBe('draft')
    expect(parseSpecStatus('approved', 'status')).toBe('approved')
    expect(() => parseSpecStatus('shipping', 'status')).toThrow(ValidationError)
    expect(() => parseSpecStatus(undefined, 'status')).toThrow(ValidationError)
    expect(() => parseSpecStatus(123, 'status')).toThrow(ValidationError)
  })

  it('optionalSpecStatus returns undefined for missing values and rejects invalid', () => {
    expect(optionalSpecStatus(undefined, 'status')).toBeUndefined()
    expect(optionalSpecStatus(null, 'status')).toBeUndefined()
    expect(optionalSpecStatus('reviewed', 'status')).toBe('reviewed')
    expect(() => optionalSpecStatus('weird', 'status')).toThrow(ValidationError)
  })

  it('parseTaskStatus accepts known values and rejects unknown', () => {
    expect(parseTaskStatus('pending', 'status')).toBe('pending')
    expect(parseTaskStatus('done', 'status')).toBe('done')
    expect(() => parseTaskStatus('shipped', 'status')).toThrow(ValidationError)
  })

  it('optionalTaskStatus returns undefined for missing values', () => {
    expect(optionalTaskStatus(undefined, 'status')).toBeUndefined()
    expect(optionalTaskStatus(null, 'status')).toBeUndefined()
    expect(optionalTaskStatus('ready', 'status')).toBe('ready')
    expect(() => optionalTaskStatus('NEW', 'status')).toThrow(ValidationError)
  })

  it('optionalComplexity rejects invalid values', () => {
    expect(optionalComplexity(undefined, 'complexity')).toBeUndefined()
    expect(optionalComplexity('standard', 'complexity')).toBe('standard')
    expect(() => optionalComplexity('huge', 'complexity')).toThrow(ValidationError)
  })

  it('optionalRequiredRole rejects invalid values', () => {
    expect(optionalRequiredRole(undefined, 'requiredRole')).toBeUndefined()
    expect(optionalRequiredRole('builder', 'requiredRole')).toBe('builder')
    expect(() => optionalRequiredRole('ops', 'requiredRole')).toThrow(ValidationError)
  })

  it('optionalDependencyKind rejects invalid values', () => {
    expect(optionalDependencyKind(undefined, 'kind')).toBeUndefined()
    expect(optionalDependencyKind('hard', 'kind')).toBe('hard')
    expect(optionalDependencyKind('soft', 'kind')).toBe('soft')
    expect(() => optionalDependencyKind('weak', 'kind')).toThrow(ValidationError)
  })
})

describe('lib/parsers — parseImportedTask', () => {
  it('parses a minimal task', () => {
    const result = parseImportedTask({ name: 'P1', prompt: '' }, 0)
    expect(result).toEqual({
      name: 'P1',
      prompt: '',
      repos: [],
      requiredRole: null,
      verification: [],
      dependsOn: [],
    })
  })

  it('parses a full task with optional fields', () => {
    const result = parseImportedTask(
      {
        name: 'P2',
        prompt: 'do work',
        repos: ['packages/api'],
        requiredRole: 'reviewer',
        verification: ['pnpm test'],
        depends_on: ['P1'],
      },
      1,
    )
    expect(result).toEqual({
      name: 'P2',
      prompt: 'do work',
      repos: ['packages/api'],
      requiredRole: 'reviewer',
      verification: ['pnpm test'],
      dependsOn: ['P1'],
    })
  })

  it('rejects non-object entries', () => {
    expect(() => parseImportedTask('not an object', 0)).toThrow(ValidationError)
    expect(() => parseImportedTask(null, 0)).toThrow(ValidationError)
    expect(() => parseImportedTask([1, 2], 0)).toThrow(ValidationError)
  })

  it('rejects missing or non-string name', () => {
    expect(() => parseImportedTask({ prompt: '' }, 0)).toThrow(ValidationError)
    expect(() => parseImportedTask({ name: 42, prompt: '' }, 0)).toThrow(ValidationError)
  })

  it('rejects non-string prompt', () => {
    expect(() => parseImportedTask({ name: 'P1', prompt: 99 }, 0)).toThrow(ValidationError)
  })

  it('rejects arrays whose elements are not strings', () => {
    expect(() => parseImportedTask({ name: 'P1', prompt: '', repos: [1, 2] }, 0))
      .toThrow(ValidationError)
    expect(() => parseImportedTask({ name: 'P1', prompt: '', verification: [true] }, 0))
      .toThrow(ValidationError)
    expect(() => parseImportedTask({ name: 'P1', prompt: '', depends_on: [null] }, 0))
      .toThrow(ValidationError)
  })

  it('rejects invalid requiredRole', () => {
    expect(() => parseImportedTask({ name: 'P1', prompt: '', requiredRole: 'ops' }, 0))
      .toThrow(ValidationError)
  })
})
