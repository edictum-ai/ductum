import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { EnrichedRun } from '@/api/client'
import { Card, CardHeader, Dot, Mono, toneColor, tokens, ago } from '@/components/signal'
import { executionModeBadgeLabel } from '@/lib/execution-integrity'
import { isSupersededProblemRun, latestRunByLineage, runActivityTime, runLineageKey } from '@/lib/run-lineage'
import { runHref, runStatusLabel, runStatusTone } from '@/lib/run-presentation'

export function HomepageLiveStreamCard({ runs }: { runs: EnrichedRun[] }) {
  const navigate = useNavigate()
  const { ordered, latestByLineage } = useMemo(() => {
    const sorted = [...runs]
      .sort((a, b) => runActivityTime(b) - runActivityTime(a))
    return { ordered: sorted.slice(0, 10), latestByLineage: latestRunByLineage(runs) }
  }, [runs])

  return (
    <Card pad={0}>
      <div style={{ padding: 20 }}>
        <CardHeader title="Live stream" meta="Recent attempt activity" action={<Dot color={tokens.ok} size={6} pulse />} />
      </div>
      <div style={{ paddingBottom: 8 }}>
        {ordered.length === 0 && (
          <div style={{ padding: '0 20px 16px' }}>
            <Mono size={12} color={tokens.faint}>— no attempts yet</Mono>
          </div>
        )}
        {ordered.map((run) => {
          const superseded = isSupersededProblemRun(run, latestByLineage.get(runLineageKey(run)))
          const color = superseded ? tokens.dim : toneColor(runStatusTone(run))
          const statusLabel = superseded ? 'Superseded' : runStatusLabel(run)
          const issueCount = run.executionIssues?.length ?? 0
          const issueColor = superseded ? tokens.dim : issueCount > 0 ? tokens.warn : tokens.faint
          const href = runHref(run)
          return (
            <div
              key={run.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(href)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') navigate(href)
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 14px 1fr auto',
                gap: 10,
                padding: '8px 20px',
                cursor: 'pointer',
                alignItems: 'baseline',
              }}
            >
              <Mono size={11} color={tokens.dim}>{ago(run.lastHeartbeat ?? run.updatedAt)}</Mono>
              <span style={{ color, fontFamily: tokens.mono, fontSize: 11, textAlign: 'center' }}>·</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: tokens.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {run.taskName}
                </div>
                <div style={{ marginTop: 1, display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                  <Mono size={10} color={tokens.faint}>{run.projectName} · {run.specName} · {run.agentName}</Mono>
                  {run.executionMode != null && (
                    <span
                      style={{
                        fontFamily: tokens.mono,
                        fontSize: 10,
                        color: issueColor,
                        border: `1px solid ${issueCount > 0 ? issueColor : tokens.hair}`,
                        borderRadius: 4,
                        padding: '0 5px',
                        lineHeight: 1.4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {executionModeBadgeLabel(run)}
                    </span>
                  )}
                </div>
              </div>
              <Mono size={10.5} color={color} style={{ textTransform: 'lowercase' }}>{statusLabel}</Mono>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
