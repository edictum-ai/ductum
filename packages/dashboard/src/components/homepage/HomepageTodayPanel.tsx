import { useEffect, useMemo, useRef } from 'react'

import type { EnrichedRun, ExecutionIntegrityReport, FactoryActivitySummary, OperatorBrief } from '@/api/client'
import { Caps, Card, Dot, Mono, tokens } from '@/components/signal'
import { EXECUTION_MODE_ORDER, buildOperatorProgressSnapshot } from '@/lib/operator-progress'
import { IntegrityIssueList, orderIntegrityIssues } from './IntegrityIssueList'
import { DisclosureSummary, HealthMetric, MetricGrid, MetricTile, ModeLine } from './HomepageTodayPrimitives'
import {
  buildHomeHealthPending,
  buildHomeHealthFromSummary,
  buildHomeVerdict,
  buildSinceLastLook,
  homeIntegritySummary,
  homeProvenanceSummary,
  homeWorkStateSummary,
} from './homepage-today-model'

const LAST_SEEN_KEY = 'ductum.home.lastSeenAt'
const UNMOUNT_MARK_SEEN_DELAY_MS = 100
let pendingLastSeenWrite: ReturnType<typeof globalThis.setTimeout> | null = null

export function HomepageTodayPanel({
  factoryName,
  brief,
  report,
  runs,
  attentionCountOverride,
  activitySummary,
  lastSeenAt,
  onMarkSeen,
}: {
  factoryName: string
  brief?: OperatorBrief
  report?: ExecutionIntegrityReport
  runs: EnrichedRun[]
  attentionCountOverride?: number
  activitySummary?: FactoryActivitySummary
  lastSeenAt?: string | null
  onMarkSeen?: (seenAt: string) => void
}) {
  const onMarkSeenRef = useRef(onMarkSeen)
  const snapshot = useMemo(() => buildOperatorProgressSnapshot(brief, report), [brief, report])
  const attentionCount = attentionCountOverride ?? brief?.queue.needsOperator ?? 0
  const health = useMemo(
    () => activitySummary == null ? buildHomeHealthPending() : buildHomeHealthFromSummary(activitySummary),
    [activitySummary],
  )
  const sinceLastLook = useMemo(() => buildSinceLastLook(runs, lastSeenAt ?? null), [runs, lastSeenAt])
  const verdict = buildHomeVerdict(snapshot, health.weekCost)
  const issues = orderIntegrityIssues(snapshot.issueSamples).slice(0, 5)

  useEffect(() => {
    onMarkSeenRef.current = onMarkSeen
  }, [onMarkSeen])

  useEffect(() => {
    cancelPendingLastSeenWrite()
    const markSeenAt = (seenAt: string) => onMarkSeenRef.current?.(seenAt)
    const markSeenNow = () => markSeenAt(new Date().toISOString())
    const scheduleMarkSeen = (seenAt: string) => {
      cancelPendingLastSeenWrite()
      pendingLastSeenWrite = globalThis.setTimeout(() => {
        pendingLastSeenWrite = null
        markSeenAt(seenAt)
      }, UNMOUNT_MARK_SEEN_DELAY_MS)
    }
    const markSeenWhenHidden = () => {
      if (globalThis.document?.visibilityState === 'hidden') markSeenNow()
    }

    globalThis.window?.addEventListener('pagehide', markSeenNow)
    globalThis.document?.addEventListener('visibilitychange', markSeenWhenHidden)
    return () => {
      globalThis.window?.removeEventListener('pagehide', markSeenNow)
      globalThis.document?.removeEventListener('visibilitychange', markSeenWhenHidden)
      scheduleMarkSeen(new Date().toISOString())
    }
  }, [])

  return (
    <section aria-labelledby="factory-today-title" style={{ display: 'grid', gap: 18 }}>
      <div
        style={{
          border: `1px solid ${tokens.hair}`,
          borderRadius: 10,
          background: tokens.canvas,
          padding: 22,
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
          <h2
            id="factory-today-title"
            style={{
              margin: 0,
              fontFamily: tokens.mono,
              fontSize: 10.5,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              color: tokens.dim,
              fontWeight: 400,
            }}
          >
            {factoryName} · today
          </h2>
          {brief?.generatedAt && <Mono size={12} color={tokens.dim}>brief {brief.generatedAt}</Mono>}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Dot color={verdict.color} size={9} pulse={snapshot.activeRuns > 0 || snapshot.approvalsWaiting > 0} />
          <div style={{ fontSize: 22, lineHeight: 1.2, color: tokens.strong, fontWeight: 600 }}>
            {verdict.text}
          </div>
        </div>
        <Mono size={12} color={tokens.dim} style={{ lineHeight: 1.5 }}>
          {sinceLastLook}
        </Mono>
      </div>

      <Card>
        <h2
          style={{
            margin: '0 0 14px',
            fontFamily: tokens.mono,
            fontSize: 9,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            color: tokens.dim,
            fontWeight: 400,
          }}
        >
          Factory health
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          <HealthMetric label="Clean done" value={health.cleanDoneRateLabel} detail={health.cleanDoneRateDetail} tone={health.cleanDone > 0 ? tokens.ok : tokens.mid} />
          <HealthMetric label="Cost / clean done" value={health.costPerCleanDoneLabel} detail={health.costDetail} tone={health.costPerCleanDoneUsd == null ? tokens.mid : tokens.accent} />
          <HealthMetric
            label="Stalled / week"
            value={String(health.stalledThisWeek)}
            detail="failed or stalled attempts"
            tone={health.stalledThisWeek > 0 ? tokens.warn : tokens.ok}
            href={health.stalledThisWeek > 0 ? '/activity' : undefined}
            actionLabel="Open activity"
          />
          <HealthMetric
            label="Caveat"
            value={health.caveatValue}
            detail={health.caveatDetail}
            tone={health.unmeasured > 0 ? tokens.warn : tokens.dim}
            href={health.unmeasured > 0 ? '/activity' : undefined}
            actionLabel="Find missing usage"
          />
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 10 }}>
        <DisclosureSummary title="Task history" meta={homeWorkStateSummary(snapshot)}>
          <MetricGrid>
            <MetricTile label="Done history" value={snapshot.taskCounts.done} tone={tokens.ok} />
            <MetricTile label="Blocked/failed history" value={snapshot.taskCounts.blocked + snapshot.taskCounts.failed} tone={attentionCount > 0 ? tokens.err : tokens.warn} hideZero />
            <MetricTile label="Active now" value={snapshot.activeRuns} tone={tokens.info} hideZero />
            <MetricTile label="Ready now" value={snapshot.readyTasks} tone={tokens.accent} hideZero />
            <MetricTile label="Pending history" value={snapshot.taskCounts.pending} tone={tokens.mid} hideZero />
          </MetricGrid>
        </DisclosureSummary>

        <DisclosureSummary title="Provenance" meta={homeProvenanceSummary(snapshot)}>
          <div style={{ display: 'grid', gap: 8 }}>
            {EXECUTION_MODE_ORDER.map((mode) => (
              <ModeLine
                key={mode}
                mode={mode}
                tasks={snapshot.taskModes[mode] ?? 0}
                runs={snapshot.runModes[mode] ?? 0}
              />
            ))}
          </div>
          <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 10, lineHeight: 1.5 }}>
            Ductum-managed, external, recorded, and inconsistent outcomes stay separated so counts do not pretend every result came through the harness.
          </Mono>
        </DisclosureSummary>

        <DisclosureSummary
          title="Integrity watch"
          meta={homeIntegritySummary(snapshot)}
          actionHref={snapshot.integrityIssues > 0 ? '/repair' : undefined}
          actionLabel="Open Repair"
        >
          {issues.length === 0 ? (
            <Mono size={12} color={tokens.dim}>No integrity contradictions.</Mono>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <IntegrityIssueList issues={issues} divided />
              {snapshot.issuesTruncated && (
                <Mono size={11} color={tokens.dim}>Showing first {issues.length} contradictions from the API summary.</Mono>
              )}
            </div>
          )}
        </DisclosureSummary>
      </div>
    </section>
  )
}

export function readLegacyHomeLastSeen(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(LAST_SEEN_KEY) ?? null
    if (value == null) return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed.toISOString()
  } catch {
    return null
  }
}

export function clearLegacyHomeLastSeen() {
  try {
    globalThis.localStorage?.removeItem(LAST_SEEN_KEY)
  } catch {
    // Ignore storage failures; server state remains authoritative.
  }
}

export function cancelPendingLastSeenWrite() {
  if (pendingLastSeenWrite == null) return
  globalThis.clearTimeout(pendingLastSeenWrite)
  pendingLastSeenWrite = null
}
