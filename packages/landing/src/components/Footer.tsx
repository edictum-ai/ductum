import { ForkMark } from './ForkMark'

const GITHUB_URL = 'https://github.com/edictum-ai/ductum'

export function Footer() {
  return (
    <footer style={{ background: 'var(--void)', borderTop: '1px solid var(--ink-line)' }}>
      <div
        className="container"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '32px 0',
          fontFamily: 'var(--mono)',
          fontSize: '11.5px',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
        }}
      >
        <a
          href="#top"
          aria-label="ductum home"
          style={{
            color: 'var(--ink)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
          }}
        >
          <ForkMark size={20} className="text-blue" />
          ductum
        </a>
        <span>Frameworks build one agent. Ductum conducts the fleet.</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'center' }}>
          <span>&copy; 2026 Ductum, Inc.</span>
          <a href={GITHUB_URL} style={{ color: 'var(--blue)' }}>
            github.com/edictum-ai/ductum
          </a>
          <span>MIT · open source</span>
        </div>
      </div>
    </footer>
  )
}
