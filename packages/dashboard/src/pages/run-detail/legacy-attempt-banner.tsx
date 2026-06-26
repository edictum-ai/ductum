import type { Attempt } from '@/api/client'
import { Caps, Card, Mono, tokens } from '@/components/signal'

export function LegacyAttemptBanner({ snapshot }: { snapshot?: Attempt['snapshot'] }) {
  if (snapshot == null || (!snapshot.legacy && snapshot.completeness === 'full')) return null
  const missingFields = snapshot.missingFields ?? []

  return (
    <Card style={{ marginBottom: 24, borderColor: `color-mix(in oklab, ${tokens.warn} 35%, ${tokens.hair})` }}>
      <Caps color={tokens.warn}>Legacy / partial history</Caps>
      <div style={{ marginTop: 8, fontSize: 14, color: tokens.strong, lineHeight: 1.5, maxWidth: 760 }}>
        This attempt was recorded without a full runtime snapshot. Historical fields stay absent on purpose, so treat
        missing metadata as incomplete history rather than current truth.
      </div>
      {missingFields.length > 0 && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 10, lineHeight: 1.5 }}>
          Missing snapshot fields: {formatMissingFields(missingFields)}
        </Mono>
      )}
    </Card>
  )
}

function formatMissingFields(fields: string[]): string {
  const preview = fields.slice(0, 4).join(', ')
  const remaining = fields.length - 4
  return remaining > 0 ? `${preview} +${remaining} more` : preview
}
