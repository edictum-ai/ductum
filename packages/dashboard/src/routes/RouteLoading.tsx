import { tokens } from '@/components/signal'

function SkeletonBlock({ height }: { height: number }) {
  return (
    <div
      className="shimmer"
      style={{
        height,
        borderRadius: 12,
        border: `1px solid ${tokens.hair}`,
        background: tokens.sunken,
      }}
    />
  )
}

export function RouteLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="fade-in"
      style={{ padding: '32px 40px 48px', maxWidth: 1280, margin: '0 auto' }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <SkeletonBlock height={52} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          <SkeletonBlock height={104} />
          <SkeletonBlock height={104} />
          <SkeletonBlock height={104} />
        </div>
        <SkeletonBlock height={240} />
      </div>
    </div>
  )
}
