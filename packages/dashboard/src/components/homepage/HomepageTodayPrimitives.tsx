import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { ExecutionMode } from '@/api/client'
import { Caps, Mono, Num, tokens } from '@/components/signal'
import { executionModeLabel } from '@/lib/execution-integrity'
import { homeModeColor } from './homepage-today-model'

export function HealthMetric({
  label,
  value,
  detail,
  tone,
  href,
  actionLabel,
}: {
  label: string
  value: string
  detail: string
  tone: string
  href?: string
  actionLabel?: string
}) {
  const body = (
    <>
      <Caps style={{ fontSize: 8.5 }}>{label}</Caps>
      <div style={{ marginTop: 7 }}>
        <Num size={24} color={tone}>{value}</Num>
      </div>
      <Mono size={10.5} color={tokens.dim} style={{ display: 'block', marginTop: 5, lineHeight: 1.35 }}>
        {detail}
      </Mono>
      {href != null && actionLabel != null && (
        <Mono size={10.5} color={tokens.accent} style={{ display: 'block', marginTop: 7 }}>
          {actionLabel}
        </Mono>
      )}
    </>
  )

  if (href == null) {
    return <div style={{ borderLeft: `2px solid ${tone}`, paddingLeft: 12, minWidth: 0 }}>{body}</div>
  }

  return (
    <Link
      to={href}
      style={{
        borderLeft: `2px solid ${tone}`,
        paddingLeft: 12,
        minWidth: 0,
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      {body}
    </Link>
  )
}

export function DisclosureSummary({
  title,
  meta,
  actionHref,
  actionLabel,
  children,
}: {
  title: string
  meta: string
  actionHref?: string
  actionLabel?: string
  children: ReactNode
}) {
  return (
    <details style={{ border: `1px solid ${tokens.hair}`, borderRadius: 8, background: tokens.canvas }}>
      <summary style={{ cursor: 'pointer', padding: '13px 16px', listStyle: 'none' }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <Caps style={{ fontSize: 9 }}>{title}</Caps>
            {actionHref != null && actionLabel != null && (
              <Link
                to={actionHref}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
                style={{
                  color: tokens.accent,
                  textDecoration: 'none',
                  fontFamily: tokens.mono,
                  fontSize: 10.5,
                }}
              >
                {actionLabel}
              </Link>
            )}
          </span>
          <Mono size={11} color={tokens.dim}>{meta}</Mono>
        </span>
      </summary>
      <div style={{ borderTop: `1px solid ${tokens.hair}`, padding: 16 }}>{children}</div>
    </details>
  )
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>{children}</div>
}

export function MetricTile({
  label,
  value,
  tone,
  hideZero,
}: {
  label: string
  value: number
  tone: string
  hideZero?: boolean
}) {
  if (hideZero === true && value === 0) return null
  return (
    <div style={{ border: `1px solid ${tokens.hair}`, borderRadius: 8, padding: '10px 12px', background: tokens.sunken }}>
      <Caps style={{ fontSize: 8.5 }}>{label}</Caps>
      <Num size={26} color={tone} style={{ display: 'block', marginTop: 8 }}>{value}</Num>
    </div>
  )
}

export function ModeLine({ mode, tasks, runs }: { mode: ExecutionMode; tasks: number; runs: number }) {
  const color = homeModeColor(mode)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', gap: 12, padding: '7px 0', borderTop: `1px solid ${tokens.hair}`, alignItems: 'center' }}>
      <Mono size={11} color={color}>{executionModeLabel(mode)}</Mono>
      <Mono size={11} color={tokens.dim} style={{ textAlign: 'right' }}>{tasks} tasks</Mono>
      <Mono size={11} color={tokens.dim} style={{ textAlign: 'right' }}>{runs} runs</Mono>
    </div>
  )
}
