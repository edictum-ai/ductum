import { useNavigate } from 'react-router-dom'

import type { Project } from '@/api/client'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { Btn, Caps, Mono, tokens } from '@/components/signal'

function enc(value: string): string {
  return encodeURIComponent(value)
}

export function HomepageEmptyState({
  projects,
  unavailableReason,
  authUnavailable: authUnavailableProp = false,
}: {
  projects?: Project[]
  unavailableReason?: string
  authUnavailable?: boolean
}) {
  const navigate = useNavigate()
  const noProjects = !projects || projects.length === 0
  const authUnavailable = authUnavailableProp || (unavailableReason?.includes('Operator token required') ?? false)
  const unavailable = unavailableReason != null || authUnavailable

  return (
    <div style={{ padding: '120px 40px', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
      <div
        style={{
          width: 80,
          height: 80,
          margin: '0 auto 32px',
          borderRadius: 20,
          border: `1px solid ${tokens.hair}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: tokens.sans,
          fontWeight: 700,
          fontSize: 32,
          color: tokens.mid,
          letterSpacing: -1,
        }}
      >
        D
      </div>
      <Caps>First steps</Caps>
      <h1
        style={{
          margin: '14px 0 0',
          fontWeight: 600,
          fontSize: 32,
          letterSpacing: -0.6,
          color: tokens.strong,
          lineHeight: 1.15,
          fontFamily: tokens.sans,
        }}
      >
        {authUnavailable
          ? 'Reconnect dashboard'
          : unavailable
            ? 'Factory data unavailable.'
            : noProjects
              ? 'No projects yet. Create one to begin.'
              : 'No specs yet. Write your first one.'}
      </h1>
      <div
        style={{
          marginTop: 16,
          color: tokens.mid,
          fontSize: 15,
          lineHeight: 1.6,
          maxWidth: 520,
          margin: '16px auto 0',
        }}
      >
        {authUnavailable
          ? 'Reconnect locally from Settings, or open a fresh dashboard link from the CLI.'
          : unavailable
            ? `The dashboard could not load factory data${unavailableReason ? `: ${unavailableReason}.` : '.'} Refresh after the API is reachable.`
            : noProjects
              ? 'A project is a repo or set of repos the factory governs. Create one here, then add specs from the project page.'
              : 'A spec is a small, self-contained description of what you want built - usually a single endpoint, screen, or fix. Ductum decomposes it into tasks, routes each to an agent, and keeps you informed.'}
      </div>
      {authUnavailable && (
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <Btn primary onClick={() => navigate('/settings#api-access')}>Session settings</Btn>
        </div>
      )}
      {!unavailable && noProjects && (
        <div
          style={{
            marginTop: 20,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <CreateProjectDialog onCreated={(projectName) => navigate(`/${enc(projectName)}`)} />
        </div>
      )}
      <div
        style={{
          marginTop: 40,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          textAlign: 'left',
        }}
      >
        {[
          ['1', 'Describe', 'Ductum reads specs, not prompts. Write what the change is, not how to do it.'],
          ['2', 'Decompose', 'Each spec becomes tasks. Each task gets a builder, a reviewer, and a watcher.'],
          ['3', 'Decide', 'You approve the merge. Evidence is gathered for you — CI, review, diff, cost.'],
        ].map(([n, h, b]) => (
          <div
            key={n}
            style={{
              padding: 18,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 10,
              background: tokens.canvas,
            }}
          >
            <Mono size={12} color={tokens.accent}>0{n}</Mono>
            <div
              style={{
                marginTop: 8,
                fontFamily: tokens.sans,
                fontSize: 17,
                fontWeight: 500,
                color: tokens.strong,
                letterSpacing: -0.2,
              }}
            >
              {h}
            </div>
            <div style={{ marginTop: 6, fontSize: 12.5, color: tokens.mid, lineHeight: 1.5 }}>
              {b}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
