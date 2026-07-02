import { Fragment, type CSSProperties, type ReactNode, type MouseEvent, type FocusEvent } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { useDuctumSSE, type DuctumSSEStatus } from '@/api/sse'
import { Dot, Kbd, Mono, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'
import { useMediaQuery } from '@/lib/hooks'
import { hasRedactionMarker } from '@/lib/project-display'

import { CommandPalette } from './CommandPalette'
import { DesktopSidebar, MobileNav } from './Sidebar'
import { TokenBanner } from './TokenBanner'

interface Crumb {
  label: string
  to?: string
}

/** Map a pathname to Signal's breadcrumb sequence. Nested slug routes
 *  decode the segments directly since the API already stores the slugs
 *  by name (no async resolution needed for the visual crumb trail). */
function crumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return [{ label: 'Factory' }, { label: 'Home' }]

  const [head] = segments
  switch (head) {
    case 'projects':
      return [{ label: 'Factory', to: '/' }, { label: 'Projects' }]
    case 'activity':
      return [{ label: 'Factory', to: '/' }, { label: 'Factory Activity' }]
    case 'audit':
      return [{ label: 'Factory', to: '/' }, { label: 'Audit Log' }]
    case 'repair':
      return [{ label: 'Factory', to: '/' }, { label: 'Repair' }]
    case 'approvals':
      return [{ label: 'Factory', to: '/' }, { label: 'Approvals' }]
    case 'settings':
      return [{ label: 'Factory', to: '/' }, { label: 'Factory Settings' }]
    case 'welcome':
      return [{ label: 'Factory', to: '/' }, { label: 'Welcome' }]
    default: {
      // /:project, /:project/:spec, /:project/:spec/:task, /:project/:spec/:task/:runId
      const decoded = segments.map((s) => decodeURIComponent(s))
      const crumbs: Crumb[] = [{ label: 'Projects', to: '/projects' }]
      if (decoded[0] != null) crumbs.push({ label: displayPathSegment(decoded[0], 'Project'), to: `/${segments[0]}` })
      if (decoded[1] != null) crumbs.push({ label: displayPathSegment(decoded[1], 'Spec'), to: `/${segments[0]}/${segments[1]}` })
      if (decoded[2] != null) crumbs.push({ label: displayPathSegment(decoded[2], 'Task'), to: `/${segments[0]}/${segments[1]}/${segments[2]}` })
      if (decoded.length === 4) {
        // Attempt id slug — trim to short form for readability.
        crumbs.push({ label: `Attempt ${shortId(decoded[3]!)}` })
        return crumbs
      }
      if (crumbs.length > 1) {
        crumbs[crumbs.length - 1] = { label: crumbs[crumbs.length - 1]!.label }
      }
      return crumbs
    }
  }
}

function displayPathSegment(value: string, fallback: string): string {
  const trimmed = value.trim()
  return trimmed === '' || hasRedactionMarker(trimmed) ? fallback : trimmed
}

function connectionColor(status: DuctumSSEStatus) {
  if (status === 'connected') return tokens.ok
  if (status === 'reconnecting' || status === 'connecting') return tokens.warn
  return tokens.err
}

function connectionLabel(status: DuctumSSEStatus) {
  if (status === 'connected') return 'connected'
  if (status === 'reconnecting') return 'reconnecting'
  if (status === 'offline') return 'offline'
  return 'connecting'
}

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('ductum:open-command-palette'))
}

function TopBar({ crumbs, connection, children }: { crumbs: Crumb[]; connection: DuctumSSEStatus; children?: ReactNode }) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 32px',
        borderBottom: `1px solid ${tokens.hair}`,
        background: tokens.bg,
        minHeight: 52,
      }}
    >
      <nav
        aria-label="Breadcrumb"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: tokens.mono,
          fontSize: 12,
          color: tokens.dim,
          minWidth: 0,
        }}
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          const isClickable = c.to != null && !last
          return (
            <Fragment key={`${i}-${c.label}`}>
              {isClickable ? (
                <Link
                  to={c.to}
                  aria-label={`Navigate to ${c.label}`}
                  style={{
                    color: tokens.mid,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 220,
                    textDecoration: 'none',
                    cursor: 'pointer',
                    borderRadius: 3,
                    padding: '1px 3px',
                    outline: 'none',
                    transition: 'color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.color = tokens.strong
                    e.currentTarget.style.background = tokens.sunken
                  }}
                  onMouseLeave={(e: MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.color = tokens.mid
                    e.currentTarget.style.background = 'transparent'
                  }}
                  onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.color = tokens.strong
                    e.currentTarget.style.background = tokens.sunken
                    e.currentTarget.style.boxShadow = `0 0 0 2px ${tokens.accent}`
                  }}
                  onBlur={(e: FocusEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.color = tokens.mid
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  style={{
                    color: last ? tokens.fg : tokens.mid,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 220,
                  }}
                >
                  {c.label}
                </span>
              )}
              {!last && <span aria-hidden style={{ color: tokens.faint }}>/</span>}
            </Fragment>
          )
        })}
      </nav>
      <div style={{ flex: 1 }} />
      {children ?? (
        <>
          <button
            type="button"
            aria-label="Search actions, projects, specs, tasks, attempts, decisions, agents"
            onClick={openCommandPalette}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              border: `1px solid ${tokens.hair}`,
              borderRadius: 7,
              fontFamily: tokens.sans,
              fontSize: 12,
              color: tokens.dim,
              minWidth: 240,
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <span style={{ opacity: 0.6 }}>Actions, projects, specs, attempts…</span>
            <div style={{ flex: 1 }} />
            <Kbd>⌘K</Kbd>
          </button>
          <Dot color={connectionColor(connection)} size={6} pulse={connection !== 'offline'} />
          <Mono size={11} color={tokens.dim}>{connectionLabel(connection)}</Mono>
        </>
      )}
    </header>
  )
}

export function Layout() {
  const sse = useDuctumSSE()
  const location = useLocation()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const crumbs = crumbsFor(location.pathname)

  if (!isDesktop) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          background: tokens.bg,
          color: tokens.fg,
          fontFamily: tokens.sans,
        }}
      >
        <MobileNav />
        <TokenBanner />
        <main
          className="sig-scroll"
          style={{ flex: 1, overflow: 'auto' }}
        >
          <Outlet />
        </main>
        <CommandPalette />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100dvh',
        background: tokens.bg,
        color: tokens.fg,
        fontFamily: tokens.sans,
      }}
    >
      <DesktopSidebar />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <TopBar crumbs={crumbs} connection={sse.status} />
        <TokenBanner />
        <main
          className="sig-scroll"
          style={{ flex: 1, overflow: 'auto' }}
        >
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}
