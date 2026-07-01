import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import type { EnrichedRun } from '@/api/client'
import { Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'
import { costCoverageValue, summarizeCostCoverage } from '@/lib/cost-coverage'
import { isAwaitingApproval } from '@/lib/derived-status'
import { displayStoredName } from '@/lib/project-display'
import { runDisplayStatus } from '@/lib/run-presentation'
import { stageLabel, WORKFLOW_STAGES } from '@/lib/stage-display'

interface SpecGroup {
  projectName: string
  specName: string
  runs: EnrichedRun[]
  liveCount: number
  taskCount: number
  awaiting: boolean
  stageIdx: number
  failing: boolean
}

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

export function HomepageActiveSpecsCard({ runs }: { runs: EnrichedRun[] }) {
  const groups = useMemo(
    () => groupBySpec(runs.filter((run) => runDisplayStatus(run) !== 'done'))
      .filter((group) => group.liveCount > 0 || group.awaiting)
      .sort((a, b) => (b.awaiting ? 1 : 0) - (a.awaiting ? 1 : 0) || b.liveCount - a.liveCount),
    [runs],
  )
  const liveRuns = groups.reduce((sum, group) => sum + group.liveCount, 0)

  return (
    <Card>
      <CardHeader
        title="Active specs"
        meta={`${groups.length} in flight · ${liveRuns} live attempt${liveRuns === 1 ? '' : 's'}`}
      />
      {groups.length === 0 ? (
        <Mono size={12} color={tokens.faint}>— nothing active right now</Mono>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {groups.map((group, index) => (
            <SpecRow
              key={`${group.projectName}/${group.specName}`}
              group={group}
              last={index === groups.length - 1}
              href={`/${enc(group.projectName)}/${enc(group.specName)}`}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function groupBySpec(runs: EnrichedRun[]): SpecGroup[] {
  const groups = new Map<string, SpecGroup>()
  for (const run of runs) {
    const key = `${run.projectName}::${run.specName}`
    let group = groups.get(key)
    if (!group) {
      group = {
        projectName: run.projectName,
        specName: run.specName,
        runs: [],
        liveCount: 0,
        taskCount: 0,
        awaiting: false,
        stageIdx: 0,
        failing: false,
      }
      groups.set(key, group)
    }
    group.runs.push(run)
    const status = runDisplayStatus(run)
    if (status === 'running') group.liveCount += 1
    if (isAwaitingApproval(run)) group.awaiting = true
    if (status === 'failed' || status === 'stalled') group.failing = true
    const stageIndex = WORKFLOW_STAGES.indexOf(run.stage as (typeof WORKFLOW_STAGES)[number])
    if (stageIndex > group.stageIdx) group.stageIdx = stageIndex
  }
  for (const group of groups.values()) {
    group.taskCount = new Set(group.runs.map((run) => run.taskName)).size
  }
  return [...groups.values()]
}

function SpecRow({
  group,
  last,
  href,
}: {
  group: SpecGroup
  last: boolean
  href: string
}) {
  const specLabel = displayStoredName(group.specName, 'Spec')
  return (
    <Link
      to={href}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        alignItems: 'center',
        gap: 20,
        padding: '18px 0',
        borderBottom: last ? 'none' : `1px solid ${tokens.hair}`,
        cursor: 'pointer',
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      <Mono size={11} color={tokens.dim} style={{ width: 92 }}>{group.projectName}</Mono>
      <div>
        <div style={{ fontFamily: tokens.sans, fontSize: 20, fontWeight: 500, color: tokens.strong, letterSpacing: -0.3 }}>
          {specLabel}
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 14, alignItems: 'center' }}>
          <StageLine stageIdx={group.stageIdx} failing={group.failing} awaiting={group.awaiting} />
          <Mono size={11} color={tokens.dim}>{group.taskCount} task{group.taskCount === 1 ? '' : 's'}</Mono>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <Mono size={11} color={tokens.dim}>cost</Mono>
        <div><Mono size={14} color={tokens.fg}>{groupCostLabel(group)}</Mono></div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 64 }}>
        {group.liveCount > 0 ? (
          <>
            <Dot color={tokens.ok} size={6} pulse />
            <Mono size={12} color={tokens.ok} style={{ marginLeft: 6 }}>{group.liveCount} live</Mono>
          </>
        ) : (
          <Mono size={12} color={tokens.dim}>idle</Mono>
        )}
      </div>
    </Link>
  )
}

function groupCostLabel(group: SpecGroup): string {
  return costCoverageValue(summarizeCostCoverage(group.runs))
}

function StageLine({
  stageIdx,
  failing,
  awaiting,
}: {
  stageIdx: number
  failing: boolean
  awaiting: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 6 }}>
      {WORKFLOW_STAGES.map((stage, index) => {
        const done = index < stageIdx
        const active = index === stageIdx
        const color = failing
          ? tokens.err
          : awaiting && active
            ? tokens.accent
            : done
              ? tokens.mid
              : active
                ? tokens.strong
                : tokens.hair
        return (
          <div
            key={stage}
            title={stageLabel(stage)}
            style={{ width: 28, height: active ? 3 : 2, background: color, borderRadius: 1 }}
          />
        )
      })}
      <Mono size={10} color={tokens.dim} style={{ marginLeft: 6 }}>
        {failing ? 'Failed' : stageLabel(WORKFLOW_STAGES[stageIdx] ?? 'Unknown')}
      </Mono>
    </div>
  )
}
