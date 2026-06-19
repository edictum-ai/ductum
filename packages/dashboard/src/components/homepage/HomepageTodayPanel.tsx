import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import type { EnrichedRun, ExecutionIntegrityReport, ExecutionMode, OperatorBrief } from '@/api/client'
import { Caps, Card, Dot, Mono, Num, tokens } from '@/components/signal'
import { executionModeLabel } from '@/lib/execution-integrity'
import { EXECUTION_MODE_ORDER, buildOperatorProgressSnapshot } from '@/lib/operator-progress'
import { buildRunSections } from './RunFeed'
import { IntegrityIssueList, orderIntegrityIssues } from './IntegrityIssueList'
import {
  buildHomeHealth,
  buildHomeVerdict,
  buildSinceLastLook,
  homeIntegritySummary,
  homeModeColor,
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
  lastSeenAt,
  onMarkSeen,
}: {
  factoryName: string
  brief?: OperatorBrief
  report?: ExecutionIntegrityReport
  runs: EnrichedRun[]
  attentionCountOverride?: number
  lastSeenAt?: string | null
  onMarkSeen?: (seenAt: string) => void
}) {
  const onMarkSeenRef = useRef(onMarkSeen)
  const snapshot = useMemo(() => buildOperatorProgressSnapshot(brief, report), [brief, report])
  const sections = useMemo(() => buildRunSections(runs), [runs])
  const attentionCount = attentionCountOverride ?? Math.max(brief?.queue.needsOperator ?? 0, sections.needsAttention.length)
  const health = useMemo(() => buildHomeHealth(runs), [runs])
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
    <section style={{ display: 'grid', gap: 18 }}>
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
          <Caps>{factoryName} · today</Caps>
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
        <Caps style={{ fontSize: 9, marginBottom: 14 }}>Factory health</Caps>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          <HealthMetric label="Clean done" value={health.cleanDoneRateLabel} detail={health.cleanDoneRateDetail} tone={health.cleanDone > 0 ? tokens.ok : tokens.mid} />
          <HealthMetric label="Cost / clean done" value={health.costPerCleanDoneLabel} detail={health.costDetail} tone={health.costPerCleanDoneUsd == null ? tokens.mid : tokens.accent} />
          <HealthMetric label="Stalled / week" value={String(health.stalledThisWeek)} detail="failed or stalled attempts" tone={health.stalledThisWeek > 0 ? tokens.warn : tokens.ok} />
          <HealthMetric label="Caveat" value={health.caveatValue} detail={health.caveatDetail} tone={health.unmeasured > 0 ? tokens.warn : tokens.dim} />
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 10 }}>
        <DisclosureSummary title="Work state" meta={homeWorkStateSummary(snapshot)}>
          <MetricGrid>
            <MetricTile label="Done" value={snapshot.taskCounts.done} tone={tokens.ok} />
            <MetricTile label="Blocked/failed" value={snapshot.taskCounts.blocked + snapshot.taskCounts.failed} tone={attentionCount > 0 ? tokens.err : tokens.warn} hideZero />
            <MetricTile label="Active" value={snapshot.taskCounts.active} tone={tokens.info} hideZero />
            <MetricTile label="Ready" value={snapshot.readyTasks} tone={tokens.accent} hideZero />
            <MetricTile label="Pending" value={snapshot.taskCounts.pending} tone={tokens.mid} hideZero />
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

        <DisclosureSummary title="Integrity watch" meta={homeIntegritySummary(snapshot)}>
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

function HealthMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <div style={{ borderLeft: `2px solid ${tone}`, paddingLeft: 12, minWidth: 0 }}>
      <Caps style={{ fontSize: 8.5 }}>{label}</Caps>
      <div style={{ marginTop: 7 }}>
        <Num size={24} color={tone}>{value}</Num>
      </div>
      <Mono size={10.5} color={tokens.dim} style={{ display: 'block', marginTop: 5, lineHeight: 1.35 }}>
        {detail}
      </Mono>
    </div>
  )
}

function DisclosureSummary({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <details style={{ border: `1px solid ${tokens.hair}`, borderRadius: 8, background: tokens.canvas }}>
      <summary style={{ cursor: 'pointer', padding: '13px 16px', listStyle: 'none' }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
          <Caps style={{ fontSize: 9 }}>{title}</Caps>
          <Mono size={11} color={tokens.dim}>{meta}</Mono>
        </span>
      </summary>
      <div style={{ borderTop: `1px solid ${tokens.hair}`, padding: 16 }}>{children}</div>
    </details>
  )
}

function MetricGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>{children}</div>
}

function MetricTile({
  label,
  value,
  tone,
  hideZero,
}: {
  label: string
  value: number
  tone: string
  hideZero?: boolean
}) {
  if (hideZero === true && value === 0) return null
  return (
    <div style={{ border: `1px solid ${tokens.hair}`, borderRadius: 8, padding: '10px 12px', background: tokens.sunken }}>
      <Caps style={{ fontSize: 8.5 }}>{label}</Caps>
      <Num size={26} color={tone} style={{ display: 'block', marginTop: 8 }}>{value}</Num>
    </div>
  )
}

function ModeLine({ mode, tasks, runs }: { mode: ExecutionMode; tasks: number; runs: number }) {
  const color = homeModeColor(mode)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', gap: 12, padding: '7px 0', borderTop: `1px solid ${tokens.hair}`, alignItems: 'center' }}>
      <Mono size={11} color={color}>{executionModeLabel(mode)}</Mono>
      <Mono size={11} color={tokens.dim} style={{ textAlign: 'right' }}>{tasks} tasks</Mono>
      <Mono size={11} color={tokens.dim} style={{ textAlign: 'right' }}>{runs} runs</Mono>
    </div>
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

function cancelPendingLastSeenWrite() {
  if (pendingLastSeenWrite == null) return
  globalThis.clearTimeout(pendingLastSeenWrite)
  pendingLastSeenWrite = null
}
