import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { EnrichedRun, Task } from '@/api/client'
import { useAgents, useAllRuns, useBakeoffCompare, useDecisions, useDeleteSpec, useResolveSpec, useTasks } from '@/api/hooks'
import {
  ago,
  agentColor,
  Btn,
  Caps,
  Card,
  CardHeader,
  Dot,
  Mono,
  toneColor,
  tokens,
} from '@/components/signal'
import { CreateTaskDialog } from '@/components/CreateTaskDialog'
import { BakeoffComparePanel } from '@/components/BakeoffComparePanel'
import { SpecBriefPanel } from '@/components/spec/SpecBriefPanel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { shortId } from '@/lib/display'
import { isAwaitingApproval } from '@/lib/derived-status'
import { executionModeBadgeLabel, hasExecutionIntegrityIssue } from '@/lib/execution-integrity'
import { costCoverageIssues, costCoverageSource, costCoverageValue, hasCostGap, summarizeCostCoverage } from '@/lib/cost-coverage'
import { displayDecisionContext, displayDecisionTitle, displayRunTaskName, displaySpecName, displayTaskName, hasRedactionMarker, runTaskRouteSegment, specRouteSegment, taskRouteSegment } from '@/lib/project-display'
import { runDisplayStatus, runStatusLabel, runStatusTone } from '@/lib/run-presentation'

function enc(s: string): string {
  return encodeURIComponent(s)
}

export function SpecDetail() {
  const { project: projectSlug, spec: specSlug } = useParams<{ project: string; spec: string }>()
  const navigate = useNavigate()
  const { data: resolved, isLoading } = useResolveSpec(projectSlug ?? '', specSlug ?? '')
  const project = resolved?.project
  const spec = resolved?.spec
  const { data: tasks } = useTasks(spec?.id ?? '')
  const taskList = tasks ?? []
  const isBakeoff = spec?.strategy === 'best_of_n' || taskList.some((task) => task.strategyRole === 'candidate')
  const { data: bakeoffCompare } = useBakeoffCompare(spec?.id ?? '', isBakeoff)
  const { data: agents } = useAgents()
  const { data: decisions } = useDecisions(spec?.id ? { specId: spec.id } : {})
  const { data: runsData } = useAllRuns({ limit: '200' })
  const runs = ((runsData as EnrichedRun[] | undefined) ?? []).filter(
    (r) => project && spec && r.projectName === project.name && r.specName === spec.name,
  )
  const deleteSpec = useDeleteSpec()
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (isLoading) {
    return (
      <div style={{ padding: '36px 40px' }}>
        <div className="shimmer" style={{ height: 180, borderRadius: 10, marginBottom: 24 }} />
        <div className="shimmer" style={{ height: 320, borderRadius: 10 }} />
      </div>
    )
  }
  if (!spec || !project) {
    const missingSpecLabel = specSlug == null || hasRedactionMarker(specSlug) ? 'The requested spec' : `The spec "${specSlug}"`
    return (
      <div style={{ padding: '36px 40px' }}>
        <Caps>Not found</Caps>
        <div style={{ marginTop: 8, color: tokens.mid }}>
          {missingSpecLabel} could not be resolved.
        </div>
      </div>
    )
  }

  const specLabel = displaySpecName(spec)
  const specSegment = specRouteSegment(spec)
  const costCoverage = summarizeCostCoverage(runs)
  const costIssues = costCoverageIssues(costCoverage)
  const measuredTokensTotal = runs.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0)
  const spendLabel = hasCostGap(costCoverage) ? 'Tracked spend' : 'Spend'
  const spendDetail = costIssues
  const liveCount = runs.filter((r) => runDisplayStatus(r) === 'running').length
  const pendingCount = runs.filter((r) => isAwaitingApproval(r)).length
  const terminalFailures = runs.filter((r) => {
    const status = runDisplayStatus(r)
    return status === 'failed' || status === 'stalled'
  })
  const failureBuckets = bucketTerminalFailures(terminalFailures, taskList, runs, spec.status)
  const terminalFailureCount = terminalFailures.length
  const doneCount = runs.filter((r) => runDisplayStatus(r) === 'done').length
  const terminalFailureSummary = terminalFailureCount > 0
    ? `${failureBuckets.current.length} current · ${failureBuckets.historical.length} historical`
    : undefined
  const terminalFailureTone = failureBuckets.current.length > 0
    ? tokens.err
    : terminalFailureCount > 0
      ? tokens.warn
      : undefined
  const spendSource = costCoverageSource(costCoverage, measuredTokensTotal)
  const openTask = (task: Task) => navigate(`/${enc(project.name)}/${enc(specSegment)}/${enc(taskRouteSegment(task))}`)
  const openRun = (task: Task, run: EnrichedRun) => navigate(
    `/${enc(project.name)}/${enc(specSegment)}/${enc(runTaskRouteSegment(run, task))}/${enc(shortId(run.id))}`,
  )
  const openFailureRun = (run: EnrichedRun) => navigate(
    `/${enc(project.name)}/${enc(specSegment)}/${enc(runTaskRouteSegment(run))}/${enc(shortId(run.id))}`,
  )

  return (
    <div
      className="fade-in"
      style={{ padding: '36px 40px 48px', maxWidth: 1280, margin: '0 auto' }}
    >
      {/* Title block */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          marginBottom: 28,
        }}
      >
        <div>
          <Caps>{project.name} · spec</Caps>
          <h1
            style={{
              margin: '12px 0 0',
              fontFamily: tokens.sans,
              fontWeight: 500,
              fontSize: 54,
              lineHeight: 1,
              letterSpacing: -1,
              color: tokens.strong,
            }}
          >
            {specLabel}
          </h1>
          <div
            style={{
              marginTop: 12,
              maxWidth: 640,
            }}
          >
            <SpecBriefPanel spec={spec} tasks={taskList} projectName={project.name} compact />
          </div>
        </div>
      </div>

      {/* Single summary surface */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          border: `1px solid ${tokens.hair}`,
          borderRadius: 10,
          background: tokens.canvas,
          marginBottom: 24,
        }}
      >
        <StatCell label="Status" value={spec.status} subtle={`opened ${ago(spec.createdAt)} ago`} />
        <StatCell label="Tasks" value={String(tasks?.length ?? 0)} />
        <StatCell label="Latest attempts" value={String(runs.length)} />
        <StatCell
          label="Live"
          value={String(liveCount)}
          color={liveCount > 0 ? tokens.ok : undefined}
        />
        <StatCell
          label="Awaiting"
          value={String(pendingCount)}
          color={pendingCount > 0 ? tokens.accent : undefined}
        />
        <StatCell
          label="Terminal attempts"
          value={String(terminalFailureCount)}
          color={terminalFailureTone}
          subtle={terminalFailureSummary}
        />
        <StatCell label="Done" value={String(doneCount)} />
	        <StatCell
	          label={spendLabel}
	          value={costCoverageValue(costCoverage)}
	          subtle={spendSource}
	          detail={spendDetail}
	          color={costCoverage.trackedUsd > 0 ? tokens.fg : tokens.dim}
	        />
      </div>

      {/* Two-col body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {isBakeoff && (
            <BakeoffComparePanel
              spec={spec}
              tasks={taskList}
              runs={runs}
              agents={agents ?? []}
              compare={bakeoffCompare}
              onOpenTask={openTask}
              onOpenRun={openRun}
            />
          )}

          <Card>
            <CardHeader
              title="Tasks"
              meta={`${tasks?.length ?? 0} task${tasks?.length === 1 ? '' : 's'} · ${liveCount} live`}
              action={<CreateTaskDialog specId={spec.id} existingTasks={tasks ?? []} />}
            />
            {!tasks || tasks.length === 0 ? (
              <Mono size={12} color={tokens.faint}>
                — no tasks yet
              </Mono>
            ) : (
              tasks.map((task, i) => {
                const taskRuns = runs.filter((r) => r.taskName === task.name)
                const last = i === tasks.length - 1
                return (
                  <TaskRow
                    key={task.id}
                    task={task}
                    runs={taskRuns}
                    last={last}
                    onOpen={() => {
                      const impl = taskRuns.find((r) => isAwaitingApproval(r)) ?? taskRuns[0]
                      if (impl) {
                        navigate(
                          `/${enc(project.name)}/${enc(specSegment)}/${enc(runTaskRouteSegment(impl, task))}/${enc(shortId(impl.id))}`,
                        )
                      } else {
                        navigate(
                          `/${enc(project.name)}/${enc(specSegment)}/${enc(taskRouteSegment(task))}`,
                        )
                      }
                    }}
                  />
                )
              })
            )}
          </Card>

          <Card>
            <CardHeader
              title="Decisions"
              meta={`${decisions?.length ?? 0} recorded`}
            />
            {!decisions || decisions.length === 0 ? (
              <Mono size={12} color={tokens.faint}>
                — no decisions recorded
              </Mono>
            ) : (
              decisions.map((d, i) => (
                <div
                  key={d.id}
                  style={{
                    padding: '14px 0',
                    borderTop: i === 0 ? 'none' : `1px solid ${tokens.hair}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 6,
                    }}
                  >
                    <Mono size={11} color={tokens.accent}>
                      {shortId(d.id)}
                    </Mono>
                    <Mono size={11} color={tokens.faint}>
                      {ago(d.createdAt)} ago · by {d.decidedBy}
                    </Mono>
                  </div>
                  <div
                    style={{
                      fontFamily: tokens.sans,
                      fontSize: 17,
                      fontWeight: 500,
                      color: tokens.strong,
                      letterSpacing: -0.2,
                      lineHeight: 1.3,
                    }}
                  >
                    {displayDecisionTitle(d)}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      color: tokens.mid,
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {displayDecisionContext(d.context)}
                  </div>
                </div>
              ))
            )}
          </Card>

          {spec.document && (
            <SpecDocumentDisclosure documentText={spec.document} />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <FailureReviewCard
            current={failureBuckets.current}
            historical={failureBuckets.historical}
            onOpenRun={openFailureRun}
          />

          <Card>
            <CardHeader title="Spec" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Btn onClick={() => navigate(`/${enc(project.name)}`)}>Open project</Btn>
              <Btn danger onClick={() => setConfirmOpen(true)}>
                Delete spec
              </Btn>
            </div>
          </Card>
        </div>
      </div>

      {/* Delete confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle>Delete spec &quot;{specLabel}&quot;?</DialogTitle>
            <DialogDescription>
              This permanently removes the spec, every task in it ({tasks?.length ?? '?'}), every
              attempt under those tasks, and every child row (activity, updates, stage history,
              evidence, gate evaluations, session mappings). Live harness sessions are killed
              first. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Btn onClick={() => setConfirmOpen(false)} disabled={deleteSpec.isPending}>
              Cancel
            </Btn>
            <Btn
              danger
              disabled={deleteSpec.isPending}
              onClick={() => {
                void deleteSpec.mutateAsync(spec.id).then(() => {
                  setConfirmOpen(false)
                  navigate(`/${enc(project.name)}`)
                })
              }}
            >
              {deleteSpec.isPending ? 'Deleting…' : 'Delete everything'}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCell({
  label,
  value,
  subtle,
  detail,
  color,
}: {
  label: string
  value: string
  subtle?: string
  detail?: string
  color?: string
}) {
  return (
    <div
      style={{
        padding: '16px 20px',
      }}
    >
      <Caps style={{ fontSize: 9 }}>{label}</Caps>
      <div
        style={{
          marginTop: 8,
          fontFamily: tokens.sans,
          fontSize: 22,
          fontWeight: 500,
          color: color ?? tokens.strong,
          letterSpacing: -0.3,
          lineHeight: 1,
          textTransform: label === 'Status' ? 'capitalize' : 'none',
        }}
      >
        {value}
      </div>
      {subtle && (
        <Mono size={11} color={tokens.dim} style={{ marginTop: 4, display: 'block' }}>
          {subtle}
        </Mono>
      )}
      {detail && (
        <Mono size={10.5} color={tokens.warn} style={{ marginTop: 4, display: 'block' }}>
          {detail}
        </Mono>
      )}
    </div>
  )
}

function SpecDocumentDisclosure({ documentText }: { documentText: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardHeader
        title="Spec document"
        meta={`${formatCompactCount(documentText.length)} chars`}
        action={(
          <Btn small onClick={() => setOpen((current) => !current)}>
            {open ? 'Hide' : 'Show'}
          </Btn>
        )}
      />
      {open ? (
        <pre
          style={{
            margin: 0,
            fontFamily: tokens.mono,
            fontSize: 12.5,
            color: tokens.mid,
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
            maxHeight: 360,
            overflow: 'auto',
          }}
          className="sig-scroll"
        >
          {documentText}
        </pre>
      ) : (
        <Mono size={12} color={tokens.faint}>
          Collapsed by default. Open only when you need the source text.
        </Mono>
      )}
    </Card>
  )
}

function TaskRow({
  task,
  runs,
  last,
  onOpen,
}: {
  task: Task
  runs: EnrichedRun[]
  last: boolean
  onOpen: () => void
}) {
  const impl = runs.find((r) => isAwaitingApproval(r)) ?? runs[0]
  const status = impl ? runDisplayStatus(impl) : null
  const c = impl ? toneColor(runStatusTone(impl)) : tokens.faint
  const cost = taskCostLabel(runs)
  const hasIntegrityIssue = hasExecutionIntegrityIssue(task)
  const mode = task.executionMode
  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      role="link"
      tabIndex={0}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 16,
        padding: '16px 0',
        cursor: 'pointer',
        borderBottom: last ? 'none' : `1px solid ${tokens.hair}`,
        alignItems: 'center',
      }}
    >
      <Dot
        color={c}
        size={8}
        pulse={status === 'running' || status === 'awaiting_approval'}
      />
      <div>
        <Mono size={12} color={tokens.fg} style={{ fontWeight: 500 }}>
          {displayTaskName(task)}
        </Mono>
        <div
          style={{
            marginTop: 4,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Mono size={10.5} color={c} style={{ textTransform: 'lowercase' }}>
            {impl ? runStatusLabel(impl) : 'no attempts yet'}
          </Mono>
          {runs.length > 1 && (
            <Mono size={10} color={tokens.faint}>
              · {runs.length} attempts
            </Mono>
          )}
          {mode && (
            <Mono
              size={10}
              color={hasIntegrityIssue ? tokens.err : mode === 'external' ? tokens.accent : tokens.faint}
              style={{
                border: `1px solid ${hasIntegrityIssue ? tokens.err : tokens.hair}`,
                borderRadius: 4,
                padding: '1px 5px',
                lineHeight: 1.4,
              }}
            >
              {executionModeBadgeLabel(task) ?? mode}
            </Mono>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {impl && (
          <>
            <Dot color={agentColor(impl.agentId)} size={6} />
            <Mono size={11} color={tokens.mid}>
              {impl.agentName}
            </Mono>
          </>
        )}
      </div>
      <Mono size={11} color={tokens.fg} style={{ textAlign: 'right', minWidth: 52 }}>
        {cost}
      </Mono>
    </div>
  )
}

function taskCostLabel(runs: EnrichedRun[]): string {
  return costCoverageValue(summarizeCostCoverage(runs))
}

type FailureBucket = {
  run: EnrichedRun
  kind: 'current' | 'historical'
  reason: string
}

function bucketTerminalFailures(
  failures: EnrichedRun[],
  tasks: Task[],
  runs: EnrichedRun[],
  specStatus: string,
): { current: FailureBucket[]; historical: FailureBucket[] } {
  const taskByName = new Map(tasks.map((task) => [task.name, task]))
  const buckets = { current: [] as FailureBucket[], historical: [] as FailureBucket[] }
  const specDone = specStatus.toLowerCase() === 'done'

  for (const run of failures) {
    const task = taskByName.get(run.taskName)
    const completedSibling = runs.some((candidate) => {
      if (candidate.id === run.id || candidate.taskName !== run.taskName) return false
      if (runDisplayStatus(candidate) !== 'done') return false
      return timestamp(candidate.updatedAt) >= timestamp(run.updatedAt)
    })
    const taskDone = task?.status === 'done' || (task == null && specDone)
    if (taskDone || completedSibling) {
      const reason = task?.status === 'done'
        ? 'task is done'
        : task == null && specDone
          ? 'spec is done'
          : 'later completed attempt'
      buckets.historical.push({
        run,
        kind: 'historical',
        reason,
      })
    } else {
      buckets.current.push({
        run,
        kind: 'current',
        reason: run.recoverable ? 'unfinished work · retryable' : 'unfinished work',
      })
    }
  }

  return buckets
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCompactCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

function FailureReviewCard({
  current,
  historical,
  onOpenRun,
}: {
  current: FailureBucket[]
  historical: FailureBucket[]
  onOpenRun: (run: EnrichedRun) => void
}) {
  const rows = [...current, ...historical]
  return (
    <Card>
      <CardHeader
        title="Failed/stalled attempts"
        meta={`${current.length} current · ${historical.length} historical`}
      />
      {rows.length === 0 ? (
        <Mono size={12} color={tokens.faint}>
          — no failed or stalled attempts
        </Mono>
      ) : (
        rows.map((item, i) => (
          <FailureRow
            key={item.run.id}
            item={item}
            last={i === rows.length - 1}
            onOpen={() => onOpenRun(item.run)}
          />
        ))
      )}
    </Card>
  )
}

function FailureRow({
  item,
  last,
  onOpen,
}: {
  item: FailureBucket
  last: boolean
  onOpen: () => void
}) {
  const status = runDisplayStatus(item.run)
  const tone = item.kind === 'current' ? tokens.err : tokens.warn
  const label = item.kind === 'current' ? 'current' : 'historical/superseded'
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 12,
        padding: '13px 0',
        borderTop: `1px solid ${tokens.hair}`,
        borderBottom: last ? 'none' : undefined,
        cursor: 'pointer',
        alignItems: 'center',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Mono size={12} color={tokens.fg} style={{ fontWeight: 500 }}>
            {displayRunTaskName(item.run)}
          </Mono>
          <Mono size={10} color={tone} style={{ textTransform: 'lowercase' }}>
            {status}
          </Mono>
          <Mono
            size={10}
            color={tone}
            style={{
              border: `1px solid color-mix(in oklab, ${tone} 45%, transparent)`,
              borderRadius: 4,
              padding: '1px 5px',
              lineHeight: 1.4,
            }}
          >
            {label}
          </Mono>
        </div>
        <Mono size={11} color={tokens.dim} style={{ marginTop: 5, display: 'block', overflowWrap: 'anywhere' }}>
          {item.run.failReason ?? item.run.completionSummary ?? item.reason}
        </Mono>
        <Mono size={10.5} color={tokens.faint} style={{ marginTop: 4, display: 'block' }}>
          {item.run.agentName} · {item.reason} · updated {ago(item.run.updatedAt)} ago
        </Mono>
      </div>
      <Mono size={11} color={tokens.accent}>
        Open attempt
      </Mono>
    </div>
  )
}
