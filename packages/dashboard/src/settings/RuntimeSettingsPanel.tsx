import { useState, type ReactNode } from 'react'

import type {
  FactoryRuntimeCurrentSettings,
  FactoryRuntimePatch,
  FactoryRuntimePersistedSettings,
  FactoryRuntimeSettings,
} from '@/api/factory-settings-types'
import { useFactoryRuntime, useUpdateFactoryRuntime } from '@/api/hooks'
import { Btn, Card, CardHeader, Mono, tokens } from '@/components/signal'
import { WriteStatus, errorText, fieldStyle } from '@/settings/controls'

type FieldKey = keyof FactoryRuntimePersistedSettings
type FieldKind = 'text' | 'number' | 'bool'
type FormState = Record<FieldKey, string>

const FIELDS: Array<{ key: FieldKey; label: string; kind: FieldKind }> = [
  { key: 'apiBindHost', label: 'api bind host', kind: 'text' },
  { key: 'apiPort', label: 'api port', kind: 'number' },
  { key: 'publicApiUrl', label: 'public api url', kind: 'text' },
  { key: 'dashboardUrl', label: 'dashboard url', kind: 'text' },
  { key: 'dispatcherEnabled', label: 'dispatcher enabled', kind: 'bool' },
  { key: 'dispatcherHeartbeatIntervalSeconds', label: 'heartbeat interval (s)', kind: 'number' },
  { key: 'worktreeEnabled', label: 'worktrees enabled', kind: 'bool' },
  { key: 'worktreeBasePath', label: 'worktree base path', kind: 'text' },
]

/**
 * Restart-aware runtime settings (GET/PATCH /api/factory/runtime).
 * Current = what the running process observes. Desired = persisted values
 * applied on the next restart. A desired value is never shown as applied.
 */
export function RuntimeSettingsPanel() {
  const runtime = useFactoryRuntime()
  const update = useUpdateFactoryRuntime()
  const [edits, setEdits] = useState<FormState | null>(null)

  if (runtime.isLoading) {
    return (
      <Card>
        <CardHeader title="Runtime" meta="current process vs desired (applied on restart)" />
        <Mono color={tokens.faint}>loading…</Mono>
      </Card>
    )
  }
  if (runtime.error != null || runtime.data == null) {
    return (
      <Card>
        <CardHeader title="Runtime" meta="current process vs desired (applied on restart)" tone={tokens.warn} />
        <Mono color={tokens.err}>{errorText(runtime.error ?? new Error('Runtime settings unavailable'))}</Mono>
      </Card>
    )
  }

  const data = runtime.data
  const saved = fromDesired(data)
  const form = edits ?? saved
  const dirty = edits != null && FIELDS.some(({ key }) => form[key] !== saved[key])
  const invalid = FIELDS.filter(
    ({ key, kind }) => kind === 'number' && form[key].trim() !== '' && !Number.isFinite(Number(form[key])),
  ).map(({ label }) => label)
  const set = (key: FieldKey, value: string) => {
    if (!update.isPending && (update.data != null || update.error != null)) update.reset()
    setEdits({ ...form, [key]: value })
  }

  function save() {
    update.mutate(buildPatch(saved, form), { onSuccess: () => setEdits(null) })
  }

  return (
    <Card>
      <CardHeader
        title="Runtime"
        meta="current process vs desired (applied on restart)"
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <WriteStatus pending={update.isPending} error={update.error} result={update.data} data-testid="runtime-settings-status" />
            <Btn
              primary
              small
              disabled={!dirty || invalid.length > 0 || update.isPending}
              onClick={save}
              aria-label="Save runtime settings"
              data-testid="runtime-settings-save"
            >
              Save
            </Btn>
          </div>
        }
      />
      {data.restartRequired && (
        <div data-testid="runtime-restart-banner" style={{ marginBottom: 12 }}>
          <Mono size={11.5} color={tokens.warn}>
            restart required → {data.affectedRuntimes.join(', ')} (desired values not applied yet)
          </Mono>
        </div>
      )}
      {/* minWidth keeps the 4 columns readable; `contain` stops the table's
          min-content from widening the page, so narrow screens scroll the
          table instead of clipping the card. */}
      <div style={{ overflowX: 'auto', contain: 'inline-size' }}>
      <div role="table" aria-label="runtime settings" style={{ display: 'grid', gap: 0, minWidth: 520 }}>
        <RowShell>
          <Mono size={10.5} color={tokens.faint} style={{ letterSpacing: 1 }}>SETTING</Mono>
          <Mono size={10.5} color={tokens.faint} style={{ letterSpacing: 1 }}>CURRENT</Mono>
          <Mono size={10.5} color={tokens.faint} style={{ letterSpacing: 1 }}>DESIRED</Mono>
          <span />
        </RowShell>
        {FIELDS.map(({ key, label, kind }) => {
          const pendingRestart = desiredDiffers(data, key)
          return (
            <RowShell key={key} top>
              <Mono size={12} color={tokens.dim}>{label}</Mono>
              <span data-testid={`runtime-current-${key}`}>
                <Mono size={12} color={tokens.fg}>{currentDisplay(data.current, key)}</Mono>
              </span>
              <DesiredEditor label={label} kind={kind} value={form[key]} onChange={(value) => set(key, value)} testId={`runtime-desired-${key}`} />
              <span data-testid={`runtime-pending-${key}`}>
                {pendingRestart && <Mono size={11} color={tokens.warn} title="desired differs from current; applies on restart">↻ restart</Mono>}
              </span>
            </RowShell>
          )
        })}
      </div>
      </div>
      {invalid.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Mono size={11} color={tokens.err}>not a number: {invalid.join(', ')}</Mono>
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${tokens.hair}` }}>
        <Fact label="db path" value={data.current?.dbPath ?? '—'} />
        <Fact label="factory data dir" value={data.current?.factoryDataDir ?? '—'} />
        <Fact label="dispatcher" value={data.current == null ? '—' : data.current.dispatcherRunning ? 'running' : 'stopped'} />
      </div>
    </Card>
  )
}

function RowShell({ children, top }: { children: ReactNode; top?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 170px) minmax(90px, 1fr) minmax(120px, 1fr) 80px',
        gap: 12,
        alignItems: 'center',
        padding: '7px 0',
        borderTop: top ? `1px solid ${tokens.hair}` : 'none',
      }}
    >
      {children}
    </div>
  )
}

function DesiredEditor({
  label,
  kind,
  value,
  onChange,
  testId,
}: {
  label: string
  kind: FieldKind
  value: string
  onChange: (value: string) => void
  testId: string
}) {
  const compact = { ...fieldStyle, minHeight: 28, fontSize: 12 }
  if (kind === 'bool') {
    return (
      <select aria-label={`${label} desired value`} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} style={compact}>
        <option value="">process default</option>
        <option value="true">enabled</option>
        <option value="false">disabled</option>
      </select>
    )
  }
  return (
    <input
      aria-label={`${label} desired value`}
      data-testid={testId}
      value={value}
      placeholder="process default"
      inputMode={kind === 'number' ? 'numeric' : undefined}
      onChange={(e) => onChange(e.target.value)}
      style={compact}
    />
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Mono size={10.5} color={tokens.faint}>{label}</Mono>
      <Mono size={11.5} color={tokens.mid} style={{ display: 'block', overflowWrap: 'anywhere' }}>{value}</Mono>
    </div>
  )
}

function fromDesired(data: FactoryRuntimeSettings): FormState {
  const out = {} as FormState
  for (const { key } of FIELDS) {
    const value = data.desired[key]
    out[key] = value == null ? '' : String(value)
  }
  return out
}

function buildPatch(saved: FormState, form: FormState): FactoryRuntimePatch {
  const patch: Record<string, string | number | boolean | null> = {}
  for (const { key, kind } of FIELDS) {
    if (form[key] === saved[key]) continue
    const raw = form[key].trim()
    if (raw === '') patch[key] = null
    else if (kind === 'number') patch[key] = Number(raw)
    else if (kind === 'bool') patch[key] = raw === 'true'
    else patch[key] = raw
  }
  return patch as FactoryRuntimePatch
}

function currentDisplay(current: FactoryRuntimeCurrentSettings | null, key: FieldKey): string {
  if (current == null) return '—'
  const value = current[key]
  if (value == null) return '—'
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled'
  return String(value)
}

function desiredDiffers(data: FactoryRuntimeSettings, key: FieldKey): boolean {
  const desired = data.desired[key]
  if (desired == null || data.current == null) return false
  return desired !== data.current[key]
}
