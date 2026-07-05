import { Menu, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { useFactoryActivitySummary, useOperatorBrief, useRepairReport } from '@/api/hooks'
import { Mono, tokens } from '@/components/signal'
import { WeekPulse } from '@/components/SidebarSpend'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useTheme } from '@/lib/theme'

const NAV_ITEMS = [
  { id: 'home',      label: 'Home',             path: '/' },
  { id: 'projects',  label: 'Projects',         path: '/projects' },
  { id: 'activity',  label: 'Factory Activity', path: '/activity' },
  { id: 'analytics', label: 'Analytics',        path: '/analytics' },
  { id: 'audit',     label: 'Audit Log',        path: '/audit' },
  { id: 'opsHealth', label: 'Ops Health',       path: '/ops-health' },
  { id: 'approvals', label: 'Approvals',        path: '/approvals' },
  { id: 'settings',  label: 'Factory Settings', path: '/settings' },
  { id: 'repair',    label: 'Repair',           path: '/repair' },
] as const

function Mark() {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        background: tokens.strong,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: tokens.bg,
        fontFamily: tokens.sans,
        fontWeight: 700,
        fontSize: 15,
        letterSpacing: -0.5,
      }}
    >
      D
    </div>
  )
}

function currentNavId(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'home'
  if (pathname.startsWith('/projects')) return 'projects'
  if (pathname.startsWith('/activity')) return 'activity'
  if (pathname.startsWith('/analytics')) return 'analytics'
  if (pathname.startsWith('/audit')) return 'audit'
  if (pathname.startsWith('/ops-health')) return 'opsHealth'
  if (pathname.startsWith('/approvals')) return 'approvals'
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname.startsWith('/repair')) return 'repair'
  if (pathname.startsWith('/welcome')) return 'home'
  return 'projects'
}

function NavContent({
  onNavigate,
  theme,
  toggleTheme,
}: {
  onNavigate?: () => void
  theme: string
  toggleTheme: () => void
}) {
  const location = useLocation()
  const currentId = currentNavId(location.pathname)
  const { data: activitySummary } = useFactoryActivitySummary()
  const { data: brief } = useOperatorBrief()
  const { data: repair } = useRepairReport()

  // Issue #244 data truth: approvals badge must come from the operator
  // brief's authoritative approvalsWaiting count (SQL/aggregate-derived
  // in countOperatorQueueRuns), not a default-limited runs list that
  // would silently lose rows past the page cap.
  const pendingCount = brief?.queue?.approvalsWaiting ?? 0
  const needsOperator = brief?.queue?.needsOperator ?? 0
  const readyTasks = brief?.queue?.readyTasks ?? 0
  const repairBlockers = repair?.summary?.blockers ?? 0

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: tokens.bg,
        fontFamily: tokens.sans,
      }}
    >
      <div style={{ padding: '20px 18px 16px' }}>
        <NavLink
          to="/"
          onClick={() => onNavigate?.()}
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <Mark />
          <div
            style={{
              fontFamily: tokens.display,
              fontVariationSettings: "'wght' 680, 'wdth' 125",
              fontSize: 15,
              color: tokens.strong,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              lineHeight: 1,
            }}
          >
            Ductum
          </div>
        </NavLink>
      </div>

      <nav aria-label="Primary" style={{ padding: '4px 10px' }}>
        {NAV_ITEMS.map((item) => {
          const active = currentId === item.id
          const badge = navBadge(item.id, { pendingCount, needsOperator, readyTasks, repairBlockers })
          return (
            <NavLink
              key={item.id}
              to={item.path}
              onClick={() => onNavigate?.()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 12px',
                textDecoration: 'none',
                textAlign: 'left',
                background: active ? tokens.raised : 'transparent',
                color: active ? tokens.strong : tokens.mid,
                borderRadius: 6,
                fontFamily: tokens.sans,
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                marginBottom: 1,
              }}
            >
              <span style={{ flex: 1 }}>{item.label}</span>
              {badge != null && <Badge count={badge.count} color={badge.color} onColor={badge.onColor} />}
            </NavLink>
          )
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <WeekPulse summary={activitySummary} />

      <div
        style={{
          padding: '8px 14px',
          borderTop: `1px solid ${tokens.hair}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 5,
            color: tokens.dim,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </div>
  )
}

type BadgeSignals = {
  pendingCount: number
  needsOperator: number
  readyTasks: number
  repairBlockers: number
}

function navBadge(
  itemId: string,
  signals: BadgeSignals,
): { count: number; color: string; onColor: string } | null {
  // White reads on the blue accent and red err fills; the amber warn fill
  // needs dark text. Use a fixed near-black (not the theme-flipping bg var)
  // so the warn badge stays legible in both themes.
  const ON_DARK = '#ffffff'
  if (itemId === 'approvals' && signals.pendingCount > 0) return { count: signals.pendingCount, color: tokens.accent, onColor: ON_DARK }
  if (itemId === 'activity') {
    if (signals.needsOperator > 0) return { count: signals.needsOperator, color: tokens.err, onColor: ON_DARK }
    if (signals.readyTasks > 0) return { count: signals.readyTasks, color: tokens.accent, onColor: ON_DARK }
  }
  if (itemId === 'repair' && signals.repairBlockers > 0) {
    return { count: signals.repairBlockers, color: tokens.err, onColor: ON_DARK }
  }
  return null
}

function Badge({ count, color, onColor }: { count: number; color: string; onColor: string }) {
  return (
    <span
      style={{
        fontFamily: tokens.mono,
        fontSize: 10,
        padding: '1px 6px',
        background: color,
        color: onColor,
        borderRadius: 4,
        fontWeight: 600,
      }}
    >
      {count}
    </span>
  )
}

export function DesktopSidebar() {
  const { theme, toggle } = useTheme()
  return (
    <aside
      style={{
        width: 188,
        flexShrink: 0,
        borderRight: `1px solid ${tokens.hair}`,
        background: tokens.bg,
      }}
    >
      <NavContent theme={theme} toggleTheme={toggle} />
    </aside>
  )
}

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const { theme, toggle } = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: `1px solid ${tokens.hair}`,
        background: tokens.bg,
        padding: '10px 12px',
      }}
    >
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open navigation">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-[220px] p-0"
          style={{ background: tokens.bg }}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <NavContent onNavigate={() => setOpen(false)} theme={theme} toggleTheme={toggle} />
        </SheetContent>
      </Sheet>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mark />
        <span
          style={{
            fontFamily: tokens.display,
            fontVariationSettings: "'wght' 680, 'wdth' 125",
            fontSize: 14,
            color: tokens.strong,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Ductum
        </span>
      </div>
    </div>
  )
}
