import { useQueries } from '@tanstack/react-query'

import { api } from '@/api/client'
import { DiffViewer } from '@/components/DiffViewer'
import { Mono, tokens } from '@/components/signal'
import type { BakeoffCompareCandidateView } from '@/components/BakeoffComparePanel'

export function BakeoffCandidateDiffGrid({ candidates }: { candidates: BakeoffCompareCandidateView[] }) {
  const queries = useQueries({
    queries: candidates.map((candidate) => ({
      queryKey: candidate.latestRunId == null
        ? ['runs', 'pending-diff', candidate.taskId]
        : ['runs', candidate.latestRunId, 'diff', 'main'],
      queryFn: () => api.getRunDiff(candidate.latestRunId as string),
      enabled: candidate.latestRunId != null,
      staleTime: 10_000,
      retry: false,
    })),
  })

  return (
    <section style={{ borderTop: `1px solid ${tokens.hair}`, paddingTop: 12 }}>
      <Mono size={11} color={tokens.dim}>Candidate diffs</Mono>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 10 }}>
        {candidates.map((candidate, index) => {
          const query = queries[index]
          return (
            <div key={candidate.taskId} style={{ minWidth: 0, border: `1px solid ${tokens.hair}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 10px', borderBottom: `1px solid ${tokens.hair}`, background: tokens.raised }}>
                <Mono size={11} color={candidate.winner ? tokens.ok : tokens.fg}>{candidate.taskName}</Mono>
              </div>
              {candidate.latestRunId == null ? (
                <div style={{ padding: 12 }}><Mono size={11} color={tokens.faint}>No attempt diff yet.</Mono></div>
              ) : (
                <div style={{ maxHeight: 420, overflow: 'auto' }}>
                  <DiffViewer diff={query?.data} isLoading={query?.isLoading ?? false} error={query?.error} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
