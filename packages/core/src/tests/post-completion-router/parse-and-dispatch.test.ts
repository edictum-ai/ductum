import { classifyTask, createFixture, createRun, createTask, describe, expect, it, parseTaskName } from './shared.js'

describe('parseTaskName', () => {
  it('classifies bare task names as impl', () => {
    expect(parseTaskName('P1')).toEqual({ kind: 'impl', originalName: 'P1', round: 0 })
    expect(parseTaskName('P5-COMMAND-PALETTE')).toEqual({ kind: 'impl', originalName: 'P5-COMMAND-PALETTE', round: 0 })
  })

  it('classifies review-* with implicit round 1', () => {
    expect(parseTaskName('review-P1')).toEqual({ kind: 'review', originalName: 'P1', round: 1 })
  })

  it('extracts the explicit round from review-X-rN', () => {
    expect(parseTaskName('review-P1-r2')).toEqual({ kind: 'review', originalName: 'P1', round: 2 })
    expect(parseTaskName('review-P5-COMMAND-PALETTE-r3')).toEqual({
      kind: 'review',
      originalName: 'P5-COMMAND-PALETTE',
      round: 3,
    })
  })

  it('extracts the round from fix-X-rN', () => {
    expect(parseTaskName('fix-P1-r1')).toEqual({ kind: 'fix', originalName: 'P1', round: 1 })
    expect(parseTaskName('fix-P5-COMMAND-PALETTE-r2')).toEqual({
      kind: 'fix',
      originalName: 'P5-COMMAND-PALETTE',
      round: 2,
    })
  })
})

describe('classifyTask', () => {
  it('treats router-created reviewer tasks as review', () => {
    const fixture = createFixture()
    const task = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    expect(classifyTask(task)).toEqual({ kind: 'review', originalName: 'P1', round: 1 })
  })

  it('treats router-created builder fix-*-rN tasks as fix', () => {
    const fixture = createFixture()
    const task = createTask(fixture, { name: 'fix-P1-r2', requiredRole: 'builder' })
    expect(classifyTask(task)).toEqual({ kind: 'fix', originalName: 'P1', round: 2 })
  })

  it('treats spec-imported impl tasks whose name starts with review- as impl', () => {
    // Regression: a human-named impl task like P18 review-verdict-strictness
    // (requiredRole=null, imported from spec) was previously misclassified
    // as a review task by name-only parsing, which left the run stuck in
    // implement after session-end because runReviewCompletion has no
    // matching `verdict-strictness` impl task to advance.
    const fixture = createFixture()
    const task = createTask(fixture, { name: 'review-verdict-strictness', requiredRole: null })
    expect(classifyTask(task)).toEqual({
      kind: 'impl',
      originalName: 'review-verdict-strictness',
      round: 0,
    })
  })

  it('treats builder tasks without a fix-*-rN name pattern as impl', () => {
    const fixture = createFixture()
    const task = createTask(fixture, { name: 'P1', requiredRole: 'builder' })
    expect(classifyTask(task)).toEqual({ kind: 'impl', originalName: 'P1', round: 0 })
  })
})

describe('PostCompletionRouter.resolveDispatchIntent', () => {
  it('returns empty intent for impl tasks (fresh worktree, no parent)', () => {
    const fixture = createFixture()
    const task = createTask(fixture, { name: 'P1' })
    expect(fixture.router.resolveDispatchIntent(task)).toEqual({})
  })

  it('points fix-* at the most recent lineage run and reuses its worktree', () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const fixTask = createTask(fixture, { name: 'fix-P1-r1' })

    const intent = fixture.router.resolveDispatchIntent(fixTask)
    expect(intent.parentRunId).toBe(implRun.id)
    expect(intent.reuseWorktreeFromRunId).toBe(implRun.id)
  })

  it('points review-* at the parent and reuses the implementation worktree', () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

    const intent = fixture.router.resolveDispatchIntent(reviewTask)
    expect(intent.parentRunId).toBe(implRun.id)
    expect(intent.reuseWorktreeFromRunId).toBe(implRun.id)
  })

  it('returns empty when no lineage parent exists yet (review of an unstarted impl)', () => {
    const fixture = createFixture()
    const orphan = createTask(fixture, { name: 'review-P9' })
    expect(fixture.router.resolveDispatchIntent(orphan)).toEqual({})
  })
})
