import { Link } from 'react-router-dom'

import { Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'
import { REPAIR_AREA_BLOCKS, REPAIR_AREA_LABEL, REPAIR_AREA_ORDER, type RepairArea } from '@/lib/repair-areas'

interface NextAction {
  label: string
  href: string
}

/** Shown when there is nothing to repair. Never a dead placeholder — it
 *  always offers concrete next actions into the normal operator loop. */
export function RepairEmptyState({ hasProjects }: { hasProjects: boolean }) {
  const actions: NextAction[] = [
    hasProjects
      ? { label: 'Create or import a spec from a project to start work', href: '/projects' }
      : { label: 'Add your first project from Projects', href: '/projects' },
    { label: 'Review live work in Factory Activity', href: '/activity' },
    { label: 'Manage agents, providers, and workflows in Factory Settings', href: '/settings' },
  ]

  return (
    <Card>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Dot color={tokens.ok} size={8} />
          <span style={{ fontSize: 16, fontWeight: 600, color: tokens.strong }}>No repair items right now</span>
        </div>
        <Mono size={12} color={tokens.mid} style={{ lineHeight: 1.5 }}>
          No current setup, readiness, or execution-integrity repair items are visible here. Next actions:
        </Mono>
        <div style={{ display: 'grid', gap: 8 }}>
          {actions.map((action) => (
            <Link
              key={action.href}
              to={action.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 8,
                padding: '11px 14px',
                background: tokens.sunken,
                color: tokens.fg,
                textDecoration: 'none',
                fontSize: 13,
              }}
            >
              <span style={{ color: tokens.info }}>→</span>
              <span>{action.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  )
}

/** The full repair taxonomy. Always rendered so the operator can see which
 *  areas Repair watches and which currently have items, even when most are
 *  empty. Areas with no current items stay hedged as "none visible". */
export function RepairAreasLegend({ counts }: { counts: Record<RepairArea, number> }) {
  return (
    <Card>
      <CardHeader title="Areas Repair watches" meta="grouped by what they block" />
      <div style={{ display: 'grid', gap: 4 }}>
        {REPAIR_AREA_ORDER.map((area) => {
          const count = counts[area] ?? 0
          const active = count > 0
          return (
            <div
              key={area}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                padding: '5px 0',
                borderTop: `1px solid ${tokens.hair}`,
              }}
            >
              <Dot color={active ? tokens.warn : tokens.ok} size={6} style={{ alignSelf: 'center' }} />
              <span style={{ fontSize: 13, color: tokens.fg, flex: '0 0 168px' }}>{REPAIR_AREA_LABEL[area]}</span>
              <Mono size={11} color={tokens.dim} style={{ flex: 1, minWidth: 0 }}>
                {REPAIR_AREA_BLOCKS[area]}
              </Mono>
              <Mono size={11} color={active ? tokens.warn : tokens.faint} style={{ flexShrink: 0 }}>
                {active ? `${count}` : 'none visible'}
              </Mono>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
