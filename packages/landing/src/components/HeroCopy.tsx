import { useState } from 'react'
import { GitHubIcon } from './ForkMark'

const GITHUB_URL = 'https://github.com/edictum-ai/ductum'
const INSTALL_CMD = 'npx ductum@latest init'

export function HeroCopy() {
  return (
    <div style={{ maxWidth: 560 }} className="hero-copy">
      {/* eyebrow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <span className="pulse-dot" aria-hidden="true" />
        <span className="eyebrow">Orchestration for AI agent fleets</span>
      </div>

      {/* brand tagline (line 01) — used once */}
      <h1 className="display" id="hero-h1" style={{ fontSize: 'clamp(38px, 5.6vw, 66px)' }}>
        Conduct the work
        <br />
        across <span style={{ color: 'var(--blue)' }}>agents.</span>
      </h1>

      {/* hook (line 03) — mechanism */}
      <p
        style={{
          marginTop: 20,
          fontFamily: 'var(--display)',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '-0.005em',
          fontSize: 'clamp(16px, 1.9vw, 20px)',
          lineHeight: 1.32,
          color: 'var(--ink)',
          maxWidth: '30ch',
        }}
      >
        From spec to shipped, across many agents.
      </p>

      {/* CTAs */}
      <div style={{ marginTop: 26, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <a className="btn btn-primary" href={GITHUB_URL}>
          <GitHubIcon size={16} />
          Star on GitHub
        </a>
        <a className="btn btn-ghost" href="#primitives">
          See the primitives
        </a>
      </div>

      <InstallChip />

      {/* meta */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 22px',
          fontFamily: 'var(--mono)',
          fontSize: 12,
          color: 'var(--ink-dim)',
        }}
      >
        <span>
          <b style={{ color: 'var(--ink)', fontWeight: 500 }}>policy</b>&nbsp; fail-closed by default
        </span>
        <span>
          <b style={{ color: 'var(--ink)', fontWeight: 500 }}>license</b>&nbsp;{' '}
          <span style={{ color: 'var(--blue)' }}>MIT</span> · open source
        </span>
        <span>
          <b style={{ color: 'var(--ink)', fontWeight: 500 }}>runtime</b>&nbsp; TypeScript · SQLite
        </span>
      </div>
    </div>
  )
}

function InstallChip() {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    const done = (): void => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(INSTALL_CMD).then(done, done)
    } else {
      const ta = document.createElement('textarea')
      ta.value = INSTALL_CMD
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        // noop
      }
      document.body.removeChild(ta)
      done()
    }
  }

  return (
    <div
      role="group"
      aria-label="Install ductum"
      style={{
        marginTop: 20,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        background: 'var(--void)',
        border: '1px solid var(--ink-line-2)',
        borderRadius: 4,
        overflow: 'hidden',
        maxWidth: '100%',
      }}
    >
      <code
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 13,
          color: 'var(--ink)',
          padding: '10px 14px',
          whiteSpace: 'nowrap',
          overflowX: 'auto',
        }}
      >
        <span style={{ color: 'var(--blue)', marginRight: 8 }}>$</span>
        {INSTALL_CMD}
      </code>
      <button
        type="button"
        aria-label="Copy install command"
        onClick={copy}
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: copied ? 'var(--done)' : 'var(--ink-dim)',
          background: copied ? 'var(--panel)' : 'var(--panel-2)',
          border: 'none',
          borderLeft: '1px solid var(--ink-line-2)',
          padding: '0 14px',
          alignSelf: 'stretch',
          cursor: 'pointer',
          transition: 'color 90ms var(--ease), background 90ms var(--ease)',
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}
