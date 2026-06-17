import { ForkMark, GitHubIcon } from './ForkMark'

const GITHUB_URL = 'https://github.com/acartag7/ductum'

export function Nav() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: 'rgba(17,19,24,0.78)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--ink-line)',
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 60,
        }}
      >
        <a
          href="#top"
          aria-label="ductum home"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 11,
            color: 'var(--ink)',
            fontFamily: 'var(--sans)',
            fontWeight: 600,
            fontSize: 19,
            letterSpacing: '-0.02em',
            textDecoration: 'none',
          }}
        >
          <ForkMark size={26} className="text-blue" />
          ductum
        </a>

        <nav
          aria-label="primary"
          style={{ display: 'flex', alignItems: 'center', gap: 26 }}
          className="topnav-links"
        >
          <NavLink href="#primitives">Primitives</NavLink>
          <NavLink href="#beliefs">Beliefs</NavLink>
          <NavLink href="#proof">Proof</NavLink>
          <NavLink href={GITHUB_URL}>Source</NavLink>
        </nav>

        <a
          className="btn btn-primary"
          href={GITHUB_URL}
          aria-label="Star ductum on GitHub"
          style={btnPrimaryStyle}
        >
          <GitHubIcon size={16} />
          <span className="topnav-star-text">Star on GitHub</span>
        </a>
      </div>

      <style>{`
        .topnav-links a {
          color: var(--ink-dim);
          font-family: var(--mono);
          font-size: 13.5px;
          font-weight: 500;
          letter-spacing: .04em;
          text-transform: uppercase;
          text-decoration: none;
          transition: color 90ms var(--ease);
        }
        .topnav-links a:hover { color: var(--ink); text-decoration: none; }
        @media (max-width: 760px) {
          .topnav-links { display: none !important; }
          .topnav-star-text { display: none !important; }
        }
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          font-family: var(--sans);
          font-weight: 600;
          font-size: 15px;
          padding: 12px 20px;
          border-radius: 4px;
          cursor: pointer;
          border: 1px solid transparent;
          text-decoration: none;
          line-height: 1;
          white-space: nowrap;
          transition: transform 90ms var(--ease), background 90ms var(--ease),
                      border-color 90ms var(--ease), color 90ms var(--ease);
        }
        .btn:active { transform: translateY(1px); }
        .btn-primary { background: var(--blue); color: #fff; }
        .btn-primary:hover { background: #3d7bf0; text-decoration: none; }
        .btn-ghost {
          background: transparent;
          color: var(--ink);
          border-color: var(--ink-line-2);
        }
        .btn-ghost:hover {
          border-color: var(--ink-dim);
          background: var(--panel);
          text-decoration: none;
        }
      `}</style>
    </header>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href}>
      {children}
    </a>
  )
}

const btnPrimaryStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
}
