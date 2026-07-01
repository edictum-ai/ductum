import { cloneElement, isValidElement, useId, useState, type ReactNode } from 'react'

import { redactPublicText } from '@ductum/public-redaction'

import type { FactorySettingsAffectedRuntime } from '@/api/factory-settings-types'
import { fieldStyle as sharedFieldStyle, Mono, textareaStyle as sharedTextareaStyle, tokens } from '@/components/signal'

export const fieldStyle = sharedFieldStyle
export const textareaStyle = sharedTextareaStyle

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const controlId = useId()
  const control = isValidElement<{ id?: string }>(children) ? children : null
  const htmlFor = control?.props.id ?? controlId
  const labeledChild = control == null ? children : cloneElement(control, { id: htmlFor })
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <FieldHeader label={label} hint={hint} htmlFor={control == null ? undefined : htmlFor} />
      {labeledChild}
    </div>
  )
}

export function FieldHeader({ label, hint, htmlFor }: { label: string; hint?: string; htmlFor?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <label htmlFor={htmlFor} title={hint} style={{ cursor: htmlFor == null ? 'default' : 'pointer' }}>
        <Mono size={11} color={tokens.dim}>{label}</Mono>
      </label>
      {hint != null && hint !== '' && <Help label={label} text={hint} />}
    </span>
  )
}

export function Help({ label, text }: { label?: string; text: string }) {
  const id = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || focused || pinned
  return (
    <button
      type="button"
      aria-label={label == null ? text : `${label} help`}
      title={text}
      aria-describedby={open ? id : undefined}
      aria-expanded={open}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setPinned((current) => !current)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setPinned((current) => !current)
        }
        if (event.key === 'Escape') setPinned(false)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        setPinned(false)
      }}
      style={{
        position: 'relative',
        display: 'inline-grid',
        placeItems: 'center',
        width: 16,
        height: 16,
        padding: 0,
        borderRadius: 999,
        border: `1px solid ${tokens.rule}`,
        background: open ? 'color-mix(in oklab, var(--signal-accent) 16%, transparent)' : tokens.canvas,
        color: open ? tokens.strong : tokens.mid,
        fontFamily: tokens.mono,
        fontSize: 10,
        lineHeight: 1,
        cursor: 'help',
        boxShadow: open ? `0 0 0 2px color-mix(in oklab, ${tokens.accent} 14%, transparent)` : 'none',
      }}
    >
      ?
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 60,
            left: '50%',
            bottom: 'calc(100% + 8px)',
            transform: 'translateX(-50%)',
            width: 260,
            maxWidth: 'min(260px, calc(100vw - 32px))',
            padding: '9px 10px',
            border: `1px solid ${tokens.rule}`,
            borderRadius: 7,
            background: tokens.raised,
            boxShadow: '0 14px 35px color-mix(in oklab, var(--signal-strong) 18%, transparent)',
            color: tokens.fg,
            fontFamily: tokens.sans,
            fontSize: 12,
            lineHeight: 1.35,
            whiteSpace: 'normal',
            textAlign: 'left',
          }}
        >
          {text}
        </span>
      )}
    </button>
  )
}

export function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function numberValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

export function boolValue(value: unknown): boolean {
  return value === true
}

export function csv(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join(', ') : ''
}

export function parseCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function parseNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Parse the API's `{ error }` JSON body into a clean, redacted message. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  try {
    const parsed = JSON.parse(error.message) as { error?: string }
    return redactPublicText(parsed.error ?? error.message)
  } catch {
    return redactPublicText(error.message)
  }
}

/**
 * Honest write-result line for typed Settings mutations. Reports `applied`
 * only when the running process took the value now; a restart-pending write
 * is reported as exactly that, with the runtimes it affects.
 */
export function WriteStatus({
  pending,
  error,
  result,
  'data-testid': testId,
}: {
  pending?: boolean
  error?: unknown
  result?: { applied: boolean; restartRequired: boolean; affectedRuntimes: FactorySettingsAffectedRuntime[] } | null
  'data-testid'?: string
}) {
  const line = pending
    ? { color: tokens.dim, text: 'saving…' }
    : error != null
      ? { color: tokens.err, text: errorText(error) }
      : result == null
        ? null
        : result.restartRequired
          ? { color: tokens.warn, text: `saved · restart required → ${result.affectedRuntimes.join(', ') || 'process'}` }
          : { color: tokens.ok, text: result.applied ? 'saved · applied' : 'saved · not yet applied' }
  if (line == null) return null
  return (
    <span data-testid={testId}>
      <Mono size={11} color={line.color}>{line.text}</Mono>
    </span>
  )
}
