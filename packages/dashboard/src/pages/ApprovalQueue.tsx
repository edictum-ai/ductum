import { useCallback, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { api, type EnrichedRun, type Evidence, type RunDiff } from '@/api/client'
import { ApprovalDecisionLine } from '@/components/approval/ApprovalDecisionLine'
import { useAllDecisions, useApproveRun, useRejectRun, useTelegramStatus } from '@/api/hooks'
import { ApprovalRow } from '@/components/approval/ApprovalRow'
import { TelegramApprovalStatus } from '@/components/approval/TelegramApprovalStatus'
import { Card, CardHeader, MetricPill, Mono, Page, PageHeader, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'
import { isAwaitingApproval } from '@/lib/derived-status'
import { buildFailureInfo, type ApprovalFailureInfo } from '@/lib/approval-recovery'

function mutationMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function ApprovalQueue() {
  const navigate = useNavigate()

  const { data: runs, isLoading, isError, error } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.listAllRuns({ stage: 'ship' }),
  })
  const approveRun = useApproveRun()
  const rejectRun = useRejectRun()
  const { data: decisionsData } = useAllDecisions()
  const telegramQuery = useTelegramStatus()

  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const [heldRuns, setHeldRuns] = useState<Map<string, EnrichedRun>>(new Map())
  const [rejectFailure, setRejectFailure] = useState<string | null>(null)
  /** Per-run approval failure state. Keyed by run.id so multiple failures
   *  can coexist and each card shows its own error. */
  const [approveFailures, setApproveFailures] = useState<Map<string, ApprovalFailureInfo>>(new Map())

  const queryPending = useMemo<EnrichedRun[]>(
    () => runs?.filter((run) => isAwaitingApproval(run)) ?? [],
    [runs],
  )

  const displayPending = useMemo(() => {
    if (heldRuns.size === 0) return queryPending
    const next = [...queryPending]
    for (const [id, run] of heldRuns) {
      if (!next.some((candidate) => candidate.id === id)) next.push(run)
    }
    return next
  }, [heldRuns, queryPending])

  const perRunQueries = useQueries({
    queries: displayPending.map((run) => ({
      queryKey: ['approvals', run.id, 'detail'],
      queryFn: () =>
        Promise.all([
          api.getRunEvidence(run.id).catch(() => [] as Evidence[]),
          api.getRun(run.id).catch(() => null),
          api.getRunDiff(run.id).catch(() => null),
        ]),
      staleTime: 10_000,
    })),
  })

  const allDecisions = decisionsData ?? []
  // Operator decisions: anyone who is NOT the agent — includes 'operator' and Telegram usernames.
  const operatorDecisions = allDecisions.filter(d => d.decidedBy !== 'agent').slice(0, 4)
  // Agent decisions: auto-recorded by the agent during an attempt.
  const agentDecisions = allDecisions.filter(d => d.decidedBy === 'agent').slice(0, 4)

  const holdForExit = useCallback((run: EnrichedRun) => {
    setHeldRuns((prev) => new Map(prev).set(run.id, run))
    setExitingIds((prev) => new Set(prev).add(run.id))
    setTimeout(() => {
      setExitingIds((prev) => {
        const next = new Set(prev)
        next.delete(run.id)
        return next
      })
      setHeldRuns((prev) => {
        const next = new Map(prev)
        next.delete(run.id)
        return next
      })
    }, 600)
  }, [])

  const handleApprove = useCallback(
    (run: EnrichedRun) => {
      setRejectFailure(null)
      // Clear any previous failure for this run before re-attempting.
      setApproveFailures((prev) => {
        if (!prev.has(run.id)) return prev
        const next = new Map(prev)
        next.delete(run.id)
        return next
      })
      approveRun.mutate(run.id, {
        onSuccess: () => holdForExit(run),
        onError: (error) => {
          setApproveFailures((prev) =>
            new Map(prev).set(run.id, buildFailureInfo(run.id, error, run.branch)),
          )
        },
      })
    },
    [approveRun, holdForExit],
  )

  const handleReject = useCallback(
    (run: EnrichedRun, reason: string) => {
      setRejectFailure(null)
      rejectRun.mutate(
        { runId: run.id, reason },
        {
          onSuccess: () => holdForExit(run),
          onError: (error) => setRejectFailure(mutationMessage(error, 'Reject failed')),
        },
      )
    },
    [rejectRun, holdForExit],
  )

  const enc = (s: string) => encodeURIComponent(s)
  const openRun = useCallback(
    (run: EnrichedRun) => {
      navigate(
        `/${enc(run.projectName)}/${enc(run.specName)}/${enc(run.taskName)}/${enc(shortId(run.id))}`,
      )
    },
    [navigate],
  )

  if (isLoading) {
    return (
      <Page maxWidth={1240}>
        <PageHeader
          eyebrow="Approvals"
          title="Approvals"
          subtitle="Loading approval queue."
          metrics={<MetricPill label="waiting" value="loading" />}
        />
        <Card style={{ minHeight: 120 }}>
          <CardHeader title="Loading approvals" meta="Checking attempts at ship stage." />
          <div className="shimmer" style={{ height: 34, borderRadius: 7 }} />
        </Card>
      </Page>
    )
  }

  if (isError) {
    return (
      <Page maxWidth={1240}>
        <PageHeader
          eyebrow="Approvals"
          title="Approvals"
          subtitle="Approval queue unavailable."
          metrics={<MetricPill label="waiting" value="error" tone="err" />}
        />
        <Card style={{ marginTop: 18 }}>
          <div style={{ fontSize: 14, color: tokens.strong, marginBottom: 6 }}>
            Queue unavailable
          </div>
          <Mono size={12} color={tokens.mid}>
            {error instanceof Error ? error.message : 'Unknown error'}
          </Mono>
        </Card>
      </Page>
    )
  }

  const count = displayPending.length
  const awaitingText = count === 1 ? 'decision awaiting you' : 'decisions awaiting you'

  return (
    <Page maxWidth={1240}>
      <PageHeader
        eyebrow="Approvals"
        title="Approvals"
        subtitle={count === 0 ? 'No decisions waiting right now.' : awaitingText}
        metrics={<MetricPill label="waiting" value={count} tone={count > 0 ? 'accent' : 'default'} />}
      />

      {rejectFailure && (
        <Card
          style={{
            marginBottom: 18,
            borderColor: `color-mix(in oklab, ${tokens.err} 35%, transparent)`,
          }}
        >
          <Mono size={11} color={tokens.err} style={{ textTransform: 'uppercase', fontWeight: 700 }}>
            Reject failed
          </Mono>
          <div style={{ marginTop: 8, fontSize: 14, color: tokens.strong }}>
            {rejectFailure}
          </div>
        </Card>
      )}

      <TelegramApprovalStatus
        status={telegramQuery.data}
        loading={telegramQuery.isLoading}
        error={telegramQuery.isError}
      />

      {count === 0 && (
        <Card style={{ marginTop: 18 }}>
          <CardHeader title="No pending approvals" meta="Approve and reject controls appear here when an attempt reaches ship stage." />
          <Mono size={12} color={tokens.dim} style={{ lineHeight: 1.5 }}>When gates are satisfied and a merge decision is waiting on you, the attempt is listed here and on its attempt page.</Mono>
        </Card>
      )}

      {displayPending.map((run, idx) => {
        const queryData = perRunQueries[idx]?.data
        const evidence: Evidence[] = Array.isArray(queryData?.[0])
          ? (queryData[0] as Evidence[])
          : []
        const runDetail = queryData?.[1] ?? null
        const diffData = (queryData?.[2] as RunDiff | null) ?? null
        const completionSummary =
          runDetail?.completionSummary ?? run.completionSummary ?? null

        return (
          <ApprovalRow
            key={run.id}
            run={run}
            evidence={evidence}
            completionSummary={completionSummary}
            diff={diffData}
            approving={approveRun.isPending}
            rejecting={rejectRun.isPending}
            exiting={exitingIds.has(run.id)}
            approvalError={approveFailures.get(run.id) ?? null}
            onApprove={handleApprove}
            onReject={handleReject}
            onOpen={openRun}
          />
        )
      })}

      {operatorDecisions.length > 0 && (
        <Card style={{ marginTop: 32 }}>
          <CardHeader title="Your recent decisions" />
          {operatorDecisions.map((d, i) => (
            <ApprovalDecisionLine
              key={d.id}
              id={d.id}
              decision={d.decision}
              context={d.context}
              createdAt={d.createdAt}
              last={i === operatorDecisions.length - 1}
            />
          ))}
        </Card>
      )}

      {agentDecisions.length > 0 && (
        <Card style={{ marginTop: 16, opacity: 0.75 }}>
          <CardHeader title="Agent-recorded decisions" meta="auto-recorded by agents during attempts" />
          {agentDecisions.map((d, i) => (
            <ApprovalDecisionLine
              key={d.id}
              id={d.id}
              decision={d.decision}
              context={d.context}
              createdAt={d.createdAt}
              last={i === agentDecisions.length - 1}
            />
          ))}
        </Card>
      )}
    </Page>
  )
}
