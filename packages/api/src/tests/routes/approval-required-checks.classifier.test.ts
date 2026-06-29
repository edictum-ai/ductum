import type { CICheckResult } from '@ductum/core'

import {
  classifyApprovalRequiredChecks,
  resolveApprovalRequiredCheckPolicy,
  type ApprovalRequiredCheckPolicy,
  type ResolvedRequiredChecks,
} from '../../lib/run-ops/approval-required-checks.js'

import { describe, expect, it } from './shared.js'

describe('approval required-checks gate — pure classifier', () => {
  type Check = CICheckResult
  const FIXED_AT = '2026-06-29T00:00:00Z'
  const NONE_REQUIRED: ResolvedRequiredChecks = { names: [], source: 'none' }

  it('classifies a fully green check set as ok', () => {
    const decision = classifyApprovalRequiredChecks(
      [
        { name: 'build-and-test', status: 'completed', conclusion: 'success' },
        { name: 'audit', status: 'completed', conclusion: 'success' },
      ],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      NONE_REQUIRED,
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
      NONE_REQUIRED,
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
      NONE_REQUIRED,
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
      NONE_REQUIRED,
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
      { names: ['build-and-test', 'deploy-preview'], source: 'policy' },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual([
      'required check "build-and-test" is in progress',
      'required check "deploy-preview" is missing',
    ])
    expect(decision.missingRequired).toEqual(['deploy-preview'])
  })

  it('Issue #195 round 3: blocks when a branch-protection required check has not appeared yet', () => {
    // Default policy (requiredChecks empty) — branch protection names
    // build-and-test and audit as required, but only audit has reported so
    // far. The gate must block on the missing required check instead of
    // merging on the partial green subset.
    const decision = classifyApprovalRequiredChecks(
      [{ name: 'audit', status: 'completed', conclusion: 'success' }],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      { names: ['audit', 'build-and-test'], source: 'branch_protection' },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual(['required check "build-and-test" is missing'])
    expect(decision.missingRequired).toEqual(['build-and-test'])
    expect(decision.requiredChecksSource).toBe('branch_protection')
  })

  it('Issue #195 round 3: passes when all branch-protection required checks are observed green', () => {
    const decision = classifyApprovalRequiredChecks(
      [
        { name: 'audit', status: 'completed', conclusion: 'success' },
        { name: 'build-and-test', status: 'completed', conclusion: 'success' },
        // Extra observed check that branch protection does not require —
        // the gate must not block on it just because it is observed.
        { name: 'optional-lint', status: 'completed', conclusion: 'success' },
      ],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      { names: ['audit', 'build-and-test'], source: 'branch_protection' },
      FIXED_AT,
    )
    expect(decision.ok).toBe(true)
    expect(decision.reasons).toEqual([])
  })

  it('disabled policy always passes', () => {
    const disabled: ApprovalRequiredCheckPolicy = resolveApprovalRequiredCheckPolicy({ enabled: false })
    expect(disabled.enabled).toBe(false)
    const decision = classifyApprovalRequiredChecks(
      [{ name: 'x', status: 'queued', conclusion: null }],
      disabled,
      NONE_REQUIRED,
      FIXED_AT,
    )
    expect(decision.ok).toBe(true)
  })

  it('resolveApprovalRequiredCheckPolicy defaults to fail-closed enabled', () => {
    const policy = resolveApprovalRequiredCheckPolicy(undefined)
    expect(policy).toEqual({ enabled: true, requiredChecks: [], failClosedOnMissing: true })
  })

  it('Issue #195 round 2: a stale earlier success does not mask a current failing rerun', () => {
    // GitHub can emit two check-run records with the same name when a check
    // is re-run on the same head SHA. The classifier must keep the NEWEST
    // attempt — here the later failure — so the merge blocks instead of
    // silently passing on the stale success.
    const decision = classifyApprovalRequiredChecks(
      [
        {
          name: 'build-and-test',
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-06-29T16:00:00Z',
        },
        {
          name: 'build-and-test',
          status: 'completed',
          conclusion: 'failure',
          startedAt: '2026-06-29T16:05:00Z',
        },
      ],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      { names: ['build-and-test'], source: 'branch_protection' },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual(['required check "build-and-test" failed'])
    expect(decision.observed).toEqual([
      expect.objectContaining({ name: 'build-and-test', conclusion: 'failure' }),
    ])
  })

  it('Issue #195 round 2: a stale earlier failure does not block a later green rerun', () => {
    // Mirror image of the previous case: the live attempt is green, so the
    // gate must pass even though an earlier recorded failure exists.
    const decision = classifyApprovalRequiredChecks(
      [
        {
          name: 'build-and-test',
          status: 'completed',
          conclusion: 'failure',
          startedAt: '2026-06-29T16:00:00Z',
        },
        {
          name: 'build-and-test',
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-06-29T16:05:00Z',
        },
      ],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      { names: ['build-and-test'], source: 'branch_protection' },
      FIXED_AT,
    )
    expect(decision.ok).toBe(true)
    expect(decision.reasons).toEqual([])
    expect(decision.observed).toEqual([
      expect.objectContaining({ name: 'build-and-test', conclusion: 'success' }),
    ])
  })

  it('Issue #195 round 2: a stale earlier success does not mask a current in-progress rerun', () => {
    // Re-runs start in queued/in-progress state; the gate must observe the
    // live in-progress attempt and block, not silently pass on the old success.
    const decision = classifyApprovalRequiredChecks(
      [
        {
          name: 'build-and-test',
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-06-29T16:00:00Z',
        },
        {
          name: 'build-and-test',
          status: 'in_progress',
          conclusion: null,
          startedAt: '2026-06-29T16:05:00Z',
        },
      ],
      { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      { names: ['build-and-test'], source: 'branch_protection' },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual(['required check "build-and-test" is in progress'])
  })

  it('Issue #195 round 2: applies newest-rerun selection to named required checks', () => {
    // Same dedupe requirement applies when `requiredChecks` is configured
    // explicitly — a stale success must not satisfy a named check that has
    // since been re-run to failure.
    const decision = classifyApprovalRequiredChecks(
      [
        {
          name: 'build-and-test',
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-06-29T16:00:00Z',
        },
        {
          name: 'build-and-test',
          status: 'completed',
          conclusion: 'failure',
          startedAt: '2026-06-29T16:05:00Z',
        },
      ],
      {
        enabled: true,
        requiredChecks: ['build-and-test'],
        failClosedOnMissing: true,
      },
      { names: ['build-and-test'], source: 'policy' },
      FIXED_AT,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reasons).toEqual(['required check "build-and-test" failed'])
  })
})
