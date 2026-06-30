import type { EnrichedRun } from '@/api/client'
import { NeedsOperatorSection } from '@/components/activity/NeedsOperatorSection'
import { Caps, Card, Dot, Mono, tokens } from '@/components/signal'
import { HomepageAwaitingBanner } from './HomepageAwaitingBanner'

export function HomepageInboxPanel({
  awaitingApproval,
  needsAttention,
  reportedApprovals,
  reportedNeedsOperator,
}: {
  awaitingApproval: EnrichedRun[]
  needsAttention: EnrichedRun[]
  reportedApprovals?: number
  reportedNeedsOperator?: number
}) {
  const approvalCount = reportedApprovals ?? awaitingApproval.length
  const needsCount = reportedNeedsOperator ?? needsAttention.length
  const totalCount = approvalCount + needsCount
  const inboxHeadline = totalCount === 1 ? '1 item needs you' : `${totalCount} items need you`

  return (
    <section aria-labelledby="home-inbox-title" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div id="home-inbox-title">
            <Caps color={totalCount > 0 ? tokens.accent : tokens.mid}>Inbox</Caps>
          </div>
          <div style={{ marginTop: 6, fontSize: 22, lineHeight: 1.15, color: tokens.strong, fontWeight: 600 }}>
            {totalCount > 0 ? inboxHeadline : 'Clear'}
          </div>
        </div>
        <Mono size={12} color={totalCount > 0 ? tokens.accent : tokens.dim}>
          {approvalCount} approvals · {needsCount} attention
        </Mono>
      </div>

      {totalCount === 0 ? (
        <Card pad={16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Dot color={tokens.ok} size={7} />
            <Mono size={12} color={tokens.dim}>No operator action is waiting.</Mono>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {(needsAttention.length > 0 || needsCount > 0) && (
            <NeedsOperatorSection attempts={needsAttention} reportedCount={reportedNeedsOperator} />
          )}
          {awaitingApproval.map((run) => (
            <HomepageAwaitingBanner key={run.id} run={run} />
          ))}
        </div>
      )}
    </section>
  )
}
