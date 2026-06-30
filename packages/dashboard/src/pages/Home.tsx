import { useCallback, useEffect, useMemo, useState } from 'react'

import type { EnrichedRun } from '@/api/client'
import { useAllRuns, useExecutionIntegrity, useFactory, useFactoryHomeViewState, useOperatorBrief, useProjects, useUpdateFactoryHomeViewState } from '@/api/hooks'
import { HomepageActiveSpecsCard } from '@/components/homepage/HomepageActiveSpecsCard'
import { HomepageEmptyState } from '@/components/homepage/HomepageEmptyState'
import { HomepageInboxPanel } from '@/components/homepage/HomepageInboxPanel'
import { HomepageLiveStreamCard } from '@/components/homepage/HomepageLiveStreamCard'
import { HomepageTodayPanel, clearLegacyHomeLastSeen, readLegacyHomeLastSeen } from '@/components/homepage/HomepageTodayPanel'
import { buildRunSections } from '@/components/homepage/RunFeed'
import { Caps, Mono, tokens } from '@/components/signal'

export function Home() {
  const { data: factory } = useFactory()
  const { data: brief, isLoading: briefLoading, isError: briefError, error: briefFailure } = useOperatorBrief()
  const { data: homeViewState, isLoading: homeViewLoading } = useFactoryHomeViewState()
  const { mutate: updateHomeViewState } = useUpdateFactoryHomeViewState()
  const { data: integrityReport, isLoading: integrityLoading, isError: integrityError, error: integrityFailure } = useExecutionIntegrity()
  const { data: projects, isLoading: projectsLoading, isError: projectsError, error: projectsFailure } = useProjects()
  const { data: runsData, isLoading: runsLoading, isError: runsError, error: runsFailure } = useAllRuns()
  const [legacyLastSeenAt] = useState(readLegacyHomeLastSeen)
  const [legacyMigrationFailed, setLegacyMigrationFailed] = useState(false)

  const runs = useMemo(() => (runsData as EnrichedRun[] | undefined) ?? [], [runsData])
  const sections = useMemo(() => buildRunSections(runs), [runs])
  const homeNeedsAttention = brief?.queue.needsOperatorAttempts ?? []
  const homeAttentionCount = brief?.queue.needsOperator ?? homeNeedsAttention.length

  const isLoading = projectsLoading || runsLoading || integrityLoading || briefLoading || homeViewLoading
  const dataUnavailable = projectsError || runsError || integrityError || briefError
  const isEmpty = !isLoading && !dataUnavailable && runs.length === 0 && (!projects || projects.length === 0)
  const { authUnavailable, unavailableReason } = getHomeUnavailableState([projectsFailure, runsFailure, integrityFailure, briefFailure])
  const lastSeenAt = homeViewState?.homeLastSeenAt ?? legacyLastSeenAt
  const legacyMigrationPending = legacyLastSeenAt != null && homeViewState != null && homeViewState.homeLastSeenAt == null && !legacyMigrationFailed
  const canMarkHomeSeen = homeViewState != null && !legacyMigrationPending
  const markHomeSeen = useCallback((homeLastSeenAt: string) => {
    updateHomeViewState({ homeLastSeenAt }, { onSuccess: clearLegacyHomeLastSeen })
  }, [updateHomeViewState])

  useEffect(() => {
    if (legacyLastSeenAt == null || homeViewState == null) return
    if (homeViewState.homeLastSeenAt != null) {
      clearLegacyHomeLastSeen()
      setLegacyMigrationFailed(false)
      return
    }
    if (legacyMigrationFailed) return
    updateHomeViewState(
      { homeLastSeenAt: legacyLastSeenAt },
      {
        onSuccess: () => {
          clearLegacyHomeLastSeen()
          setLegacyMigrationFailed(false)
        },
        onError: () => setLegacyMigrationFailed(true),
      },
    )
  }, [homeViewState, legacyLastSeenAt, legacyMigrationFailed, updateHomeViewState])

  if (isLoading) {
    return <HomeLoadingState />
  }

  if (isEmpty) {
    return <HomepageEmptyState projects={projects} />
  }

  if (!isLoading && dataUnavailable && runs.length === 0 && (!projects || projects.length === 0)) {
    return <HomepageEmptyState projects={projects} unavailableReason={unavailableReason} authUnavailable={authUnavailable} />
  }

  const factoryName = factory?.name ?? 'Ductum'

  return (
    <div className="fade-in" style={{ padding: '32px 40px 48px', maxWidth: 1440, margin: '0 auto' }}>
      <HomepageInboxPanel
        awaitingApproval={sections.awaitingApproval}
        needsAttention={homeNeedsAttention}
        reportedApprovals={brief?.queue.approvalsWaiting}
        reportedNeedsOperator={brief?.queue.needsOperator}
      />

      <div style={{ marginTop: 24 }}>
        <HomepageTodayPanel
          factoryName={factoryName}
          brief={brief}
          report={integrityReport}
          runs={runs}
          attentionCountOverride={homeAttentionCount}
          lastSeenAt={lastSeenAt}
          onMarkSeen={canMarkHomeSeen ? markHomeSeen : undefined}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr',
          gap: 24,
          marginTop: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <HomepageActiveSpecsCard runs={runs} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <HomepageLiveStreamCard runs={runs} />
        </div>
      </div>
    </div>
  )
}

function HomeLoadingState() {
  return (
    <div style={{ padding: '32px 40px', maxWidth: 960 }}>
      <div style={{ border: `1px solid ${tokens.hair}`, borderRadius: 10, background: tokens.canvas, padding: 20, marginBottom: 24 }}>
        <Caps color={tokens.accent}>Loading local factory session</Caps>
        <div style={{ marginTop: 10, fontSize: 22, lineHeight: 1.2, color: tokens.strong, fontWeight: 600 }}>
          Opening dashboard data...
        </div>
        <Mono size={12} color={tokens.dim} style={{ display: 'block', marginTop: 10, lineHeight: 1.5 }}>
          If this does not resolve, run ductum start and open the local dashboard from that session.
        </Mono>
      </div>
      <div className="shimmer" style={{ height: 120, borderRadius: 10, marginBottom: 24 }} />
      <div className="shimmer" style={{ height: 280, borderRadius: 10 }} />
    </div>
  )
}

interface HomeUnavailableState {
  authUnavailable: boolean
  unavailableReason: string | undefined
}

export function getHomeUnavailableState(failures: readonly unknown[]): HomeUnavailableState {
  const errorFailures = failures.filter(isError)
  const authUnavailable = errorFailures.length > 0 && errorFailures.every(isOperatorAuthFailure)
  const unavailableReason = (authUnavailable
    ? errorFailures[0]
    : errorFailures.find((failure) => !isOperatorAuthFailure(failure)) ?? errorFailures[0])?.message

  return { authUnavailable, unavailableReason }
}

function isError(failure: unknown): failure is Error {
  return failure instanceof Error
}

function isOperatorAuthFailure(failure: Error): boolean {
  const status = (failure as { status?: unknown }).status
  return status === 401 || failure.message.includes('Operator token required')
}
