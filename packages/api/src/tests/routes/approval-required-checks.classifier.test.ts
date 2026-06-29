import type { CICheckResult } from '@ductum/core'

import {
  classifyApprovalRequiredChecks,
  resolveApprovalRequiredCheckPolicy,
  type ApprovalRequiredCheckPolicy,
} from '../../lib/run-ops/approval-required-checks.js'

import { describe, expect, it } from './shared.js'

describe('approval required-checks gate — pure classifier', () => {
  type Check = CICheckResult
  const FIXED_AT = '2026-06-29T00:00:00Z'

  it('classifies a fully green check set as ok', () => {
    const decision = classifyApprovalRequiredChecks(
      [
        { name: 'build-and-test', status: 'completed', conclusion: 'success' },
        { name: 'audit', status: 'completed', conclusion: 'success' },
      ],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      FIXED_AT,
    )
    expect(decision.ok).toBe(true)
    expect(decision.reasons).toEqual([])
  })

  it('flags queued, in-progress, failed, timed-out, skipped, and neutral checks', () => {
    const checks: Check[] = [
      { name: 'queued-check', status: 'queued', conclusion: null },
      { name: 'running-check', status: 'in_progress', conclusion: null },
      { name: 'failed-check', status: 'completed', conclusion: 'failure' },
      { name: 'timed-out-check', status: 'completed', conclusion: 'timed_out' },
      { name: 'skipped-check', status: 'completed', conclusion: 'skipped' },
      { name: 'neutral-check', status: 'completed', conclusion: 'neutral' },
    ]
    const decision = classifyApprovalRequiredChecks(
      checks,
      { enabled: true, requiredChecks: [], failClosedOnMissing: false },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual([
      'check "queued-check" is queued',
      'check "running-check" is in progress',
      'check "failed-check" failed',
      'check "timed-out-check" timed out',
      'check "skipped-check" was skipped unexpectedly',
      'check "neutral-check" finished neutral',
    ])
  })

  it('fails closed when no checks are observed and failClosedOnMissing=true', () => {
    const decision = classifyApprovalRequiredChecks(
      [],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual([
      'no CI checks observed for the pinned PR head (expected at least one passing check)',
    ])
  })

  it('passes when no checks are observed but failClosedOnMissing=false', () => {
    const decision = classifyApprovalRequiredChecks(
      [],
      { enabled: true, requiredChecks: [], failClosedOnMissing: false },
      FIXED_AT,
    )
    expect(decision.ok).toBe(true)
  })

  it('flags missing named required checks even when other checks pass', () => {
    const decision = classifyApprovalRequiredChecks(
      [
        { name: 'audit', status: 'completed', conclusion: 'success' },
        { name: 'build-and-test', status: 'in_progress', conclusion: null },
      ],
      {
        enabled: true,
        requiredChecks: ['build-and-test', 'deploy-preview'],
        failClosedOnMissing: true,
      },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual([
      'required check "build-and-test" is in progress',
      'required check "deploy-preview" is missing',
    ])
    expect(decision.missingRequired).toEqual(['deploy-preview'])
  })

  it('disabled policy always passes', () => {
    const disabled: ApprovalRequiredCheckPolicy = resolveApprovalRequiredCheckPolicy({ enabled: false })
    expect(disabled.enabled).toBe(false)
    const decision = classifyApprovalRequiredChecks(
      [{ name: 'x', status: 'queued', conclusion: null }],
      disabled,
      FIXED_AT,
    )
    expect(decision.ok).toBe(true)
  })

  it('resolveApprovalRequiredCheckPolicy defaults to fail-closed enabled', () => {
    const policy = resolveApprovalRequiredCheckPolicy(undefined)
    expect(policy).toEqual({ enabled: true, requiredChecks: [], failClosedOnMissing: true })
  })
})
