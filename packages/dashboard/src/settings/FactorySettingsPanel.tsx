import { useState } from 'react'

import type { FactorySettingsDetails, FactorySettingsPatch } from '@/api/factory-settings-types'
import { useFactorySettingsDetails, useUpdateFactorySettings } from '@/api/hooks'
import { Btn, Card, CardHeader, Mono, tokens } from '@/components/signal'
import { Field, fieldStyle, WriteStatus, errorText } from '@/settings/controls'

interface FormState {
  name: string
  defaultMergeMode: 'auto' | 'human'
  heartbeatTimeoutSeconds: string
  perRunWarnUsd: string
  perRunHardUsd: string
  perSpecHardUsd: string
}

/** Editable Factory defaults backed by GET/PATCH /api/factory/settings. */
export function FactorySettingsPanel() {
  const details = useFactorySettingsDetails()
  const update = useUpdateFactorySettings()
  const [edits, setEdits] = useState<FormState | null>(null)

  if (details.isLoading) {
    return (
      <Card>
        <CardHeader title="Factory" meta="defaults for new work" />
        <Mono color={tokens.faint}>loading…</Mono>
      </Card>
    )
  }
  if (details.error != null || details.data == null) {
    return (
      <Card>
        <CardHeader title="Factory" meta="defaults for new work" tone={tokens.warn} />
        <Mono color={tokens.err}>{errorText(details.error ?? new Error('Factory settings unavailable'))}</Mono>
      </Card>
    )
  }

  const saved = fromDetails(details.data)
  const form = edits ?? saved
  const dirty = edits != null && !sameForm(edits, saved)
  const invalid = invalidFields(form)
  const set = (patch: Partial<FormState>) => {
    if (!update.isPending && (update.data != null || update.error != null)) update.reset()
    setEdits({ ...form, ...patch })
  }

  function save() {
    const patch = buildPatch(saved, form)
    update.mutate(patch, { onSuccess: () => setEdits(null) })
  }

  return (
    <Card>
      <CardHeader
        title="Factory"
        meta="defaults for new work"
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <WriteStatus pending={update.isPending} error={update.error} result={update.data} data-testid="factory-settings-status" />
            <Btn
              primary
              small
              disabled={!dirty || invalid.length > 0 || update.isPending}
              onClick={save}
              data-testid="factory-settings-save"
            >
              Save
            </Btn>
          </div>
        }
      />
      <div data-testid="factory-settings-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <Field label="factory name">
          <input
            data-testid="factory-name-input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            style={fieldStyle}
          />
        </Field>
        <Field label="default merge mode" hint="auto merges approved work without an operator click; human waits for approval">
          <select
            data-testid="factory-merge-mode"
            value={form.defaultMergeMode}
            onChange={(e) => set({ defaultMergeMode: e.target.value as FormState['defaultMergeMode'] })}
            style={fieldStyle}
          >
            <option value="human">human</option>
            <option value="auto">auto</option>
          </select>
        </Field>
        <Field label="heartbeat timeout (s)" hint="applies to future runs; existing runs keep their snapshot">
          <input
            data-testid="factory-heartbeat-input"
            inputMode="numeric"
            value={form.heartbeatTimeoutSeconds}
            onChange={(e) => set({ heartbeatTimeoutSeconds: e.target.value })}
            style={fieldStyle}
          />
        </Field>
        <Field label="per-run warn budget ($)">
          <input
            data-testid="factory-budget-warn"
            inputMode="decimal"
            value={form.perRunWarnUsd}
            placeholder="none"
            onChange={(e) => set({ perRunWarnUsd: e.target.value })}
            style={fieldStyle}
          />
        </Field>
        <Field label="per-run hard budget ($)">
          <input
            data-testid="factory-budget-hard"
            inputMode="decimal"
            value={form.perRunHardUsd}
            placeholder="none"
            onChange={(e) => set({ perRunHardUsd: e.target.value })}
            style={fieldStyle}
          />
        </Field>
        <Field label="per-spec hard budget ($)">
          <input
            data-testid="factory-budget-spec"
            inputMode="decimal"
            value={form.perSpecHardUsd}
            placeholder="none"
            onChange={(e) => set({ perSpecHardUsd: e.target.value })}
            style={fieldStyle}
          />
        </Field>
      </div>
      {invalid.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Mono size={11} color={tokens.err}>not a number: {invalid.join(', ')}</Mono>
        </div>
      )}
    </Card>
  )
}

function fromDetails(details: FactorySettingsDetails): FormState {
  return {
    name: details.name,
    defaultMergeMode: details.defaultMergeMode,
    heartbeatTimeoutSeconds: String(details.heartbeatTimeoutSeconds),
    perRunWarnUsd: numberField(details.budgets.perRunWarnUsd),
    perRunHardUsd: numberField(details.budgets.perRunHardUsd),
    perSpecHardUsd: numberField(details.budgets.perSpecHardUsd),
  }
}

function buildPatch(saved: FormState, form: FormState): FactorySettingsPatch {
  const patch: FactorySettingsPatch = {}
  if (form.name !== saved.name) patch.name = form.name
  if (form.defaultMergeMode !== saved.defaultMergeMode) patch.defaultMergeMode = form.defaultMergeMode
  if (form.heartbeatTimeoutSeconds !== saved.heartbeatTimeoutSeconds) {
    patch.heartbeatTimeoutSeconds = Number(form.heartbeatTimeoutSeconds)
  }
  const budgetKeys = ['perRunWarnUsd', 'perRunHardUsd', 'perSpecHardUsd'] as const
  if (budgetKeys.some((key) => form[key] !== saved[key])) {
    patch.budgets = {
      perRunWarnUsd: budgetValue(form.perRunWarnUsd),
      perRunHardUsd: budgetValue(form.perRunHardUsd),
      perSpecHardUsd: budgetValue(form.perSpecHardUsd),
    }
  }
  return patch
}

function invalidFields(form: FormState): string[] {
  const bad: string[] = []
  if (!Number.isFinite(Number(form.heartbeatTimeoutSeconds)) || form.heartbeatTimeoutSeconds.trim() === '') {
    bad.push('heartbeat timeout')
  }
  for (const [key, label] of [
    ['perRunWarnUsd', 'per-run warn budget'],
    ['perRunHardUsd', 'per-run hard budget'],
    ['perSpecHardUsd', 'per-spec hard budget'],
  ] as const) {
    const raw = form[key].trim()
    if (raw !== '' && !Number.isFinite(Number(raw))) bad.push(label)
  }
  return bad
}

function sameForm(a: FormState, b: FormState): boolean {
  return (Object.keys(a) as Array<keyof FormState>).every((key) => a[key] === b[key])
}

function numberField(value: number | null): string {
  return value == null ? '' : String(value)
}

function budgetValue(raw: string): number | null {
  return raw.trim() === '' ? null : Number(raw)
}
