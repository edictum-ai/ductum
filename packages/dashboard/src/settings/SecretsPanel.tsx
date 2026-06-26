import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import type { FactorySecretMetadata } from '@/api/factory-settings-types'
import { useFactorySecrets } from '@/api/hooks'
import { Btn, Card, CardHeader, Mono, ago, tokens } from '@/components/signal'
import { Field, errorText, fieldStyle } from '@/settings/controls'

/**
 * Encrypted write-only secrets (/api/factory/secrets). Plaintext is held only
 * in local input state, sent once per create/rotate, and cleared on success.
 * Secret writes deliberately bypass useMutation so plaintext never lands in
 * any react-query cache; reads return metadata/status only.
 */
export function SecretsPanel() {
  const qc = useQueryClient()
  const secrets = useFactorySecrets()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rotateId, setRotateId] = useState<string | null>(null)
  const [rotateValue, setRotateValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function run(action: string, work: () => Promise<void>, done: string) {
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      await work()
      await qc.invalidateQueries({ queryKey: ['factory', 'secrets'] })
      setNotice(done)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  function create() {
    // Plaintext leaves rendered state at submit time, not on success: hold it
    // in a local for the one outgoing request and clear the input now. A
    // failed write keeps the input empty — the operator retypes the value.
    const submitted = value
    setValue('')
    void run('create', async () => {
      await api.createFactorySecret({
        name: name.trim(),
        value: submitted,
        ...(description.trim() === '' ? {} : { description: description.trim() }),
      })
      setName('')
      setDescription('')
    }, 'secret saved · value is write-only')
  }

  function rotate(id: string) {
    // Same write-only contract as create: clear at submit, never restore.
    const submitted = rotateValue
    setRotateValue('')
    void run(`rotate:${id}`, async () => {
      await api.updateFactorySecret(id, { value: submitted })
      setRotateId(null)
    }, 'secret rotated · value is write-only')
  }

  function test(id: string) {
    void run(`test:${id}`, async () => {
      await api.testFactorySecret(id)
    }, 'secret resolved')
  }

  function remove(id: string) {
    void run(`delete:${id}`, async () => {
      await api.deleteFactorySecret(id)
      setConfirmDeleteId(null)
    }, 'secret deleted')
  }

  const rows = secrets.data ?? []
  return (
    <Card>
      <CardHeader
        title="Secrets"
        meta="encrypted · write-only after save"
        action={
          <span data-testid="secrets-status">
            {error != null && <Mono size={11} color={tokens.err}>{error}</Mono>}
            {error == null && notice != null && <Mono size={11} color={tokens.ok}>{notice}</Mono>}
            {busy != null && <Mono size={11} color={tokens.dim}> working…</Mono>}
          </span>
        }
      />
      {secrets.error != null ? (
        <Mono color={tokens.err}>{errorText(secrets.error)}</Mono>
      ) : rows.length === 0 ? (
        <Mono color={tokens.faint}>{secrets.isLoading ? 'loading…' : 'No secrets stored'}</Mono>
      ) : (
        rows.map((secret, i) => (
          <SecretRow
            key={secret.id}
            secret={secret}
            first={i === 0}
            busy={busy}
            rotating={rotateId === secret.id}
            rotateValue={rotateValue}
            confirmingDelete={confirmDeleteId === secret.id}
            onRotateToggle={() => {
              setRotateId(rotateId === secret.id ? null : secret.id)
              setRotateValue('')
            }}
            onRotateValue={setRotateValue}
            onRotateConfirm={() => rotate(secret.id)}
            onTest={() => test(secret.id)}
            onDelete={() => (confirmDeleteId === secret.id ? remove(secret.id) : setConfirmDeleteId(secret.id))}
          />
        ))
      )}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${tokens.hair}`, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
        <Field label="name">
          <input data-testid="secret-create-name" value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} autoComplete="off" />
        </Field>
        <Field label="value" hint="encrypted at rest; never shown again after save">
          <input data-testid="secret-create-value" type="password" value={value} onChange={(e) => setValue(e.target.value)} style={fieldStyle} autoComplete="new-password" />
        </Field>
        <Field label="description (optional)">
          <input data-testid="secret-create-description" value={description} onChange={(e) => setDescription(e.target.value)} style={fieldStyle} autoComplete="off" />
        </Field>
        <Btn
          primary
          disabled={name.trim() === '' || value === '' || busy != null}
          onClick={create}
          aria-label="Add secret"
          data-testid="secret-create-submit"
        >
          Add secret
        </Btn>
      </div>
    </Card>
  )
}

function SecretRow({
  secret,
  first,
  busy,
  rotating,
  rotateValue,
  confirmingDelete,
  onRotateToggle,
  onRotateValue,
  onRotateConfirm,
  onTest,
  onDelete,
}: {
  secret: FactorySecretMetadata
  first: boolean
  busy: string | null
  rotating: boolean
  rotateValue: string
  confirmingDelete: boolean
  onRotateToggle: () => void
  onRotateValue: (value: string) => void
  onRotateConfirm: () => void
  onTest: () => void
  onDelete: () => void
}) {
  return (
    <div data-testid={`secret-row-${secret.name}`} style={{ padding: '10px 0', borderTop: first ? 'none' : `1px solid ${tokens.hair}` }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: tokens.sans, fontSize: 14, color: tokens.strong }}>{secret.name}</span>
          <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 2 }}>
            {secret.scope} · rotated {ago(secret.lastRotatedAt)} · tested {ago(secret.lastTestedAt)}
          </Mono>
        </div>
        <Mono size={11} color={statusColor(secret.status)}>{secret.status}</Mono>
        <Btn small onClick={onTest} disabled={busy != null} aria-label={`Test ${secret.name}`} data-testid={`secret-test-${secret.name}`}>Test</Btn>
        <Btn small onClick={onRotateToggle} disabled={busy != null} aria-label={`${rotating ? 'Cancel rotating' : 'Rotate'} ${secret.name}`} data-testid={`secret-rotate-${secret.name}`}>
          {rotating ? 'Cancel' : 'Rotate'}
        </Btn>
        <Btn small danger onClick={onDelete} disabled={busy != null} aria-label={`${confirmingDelete ? 'Confirm delete' : 'Delete'} ${secret.name}`} data-testid={`secret-delete-${secret.name}`}>
          {confirmingDelete ? 'Confirm delete' : 'Delete'}
        </Btn>
      </div>
      {rotating && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
          <input
            aria-label={`New value for ${secret.name}`}
            data-testid="secret-rotate-input"
            type="password"
            value={rotateValue}
            onChange={(e) => onRotateValue(e.target.value)}
            placeholder="new value"
            style={{ ...fieldStyle, minHeight: 28, fontSize: 12, maxWidth: 320 }}
            autoComplete="new-password"
          />
          <Btn small primary disabled={rotateValue === '' || busy != null} onClick={onRotateConfirm} aria-label={`Save new value for ${secret.name}`} data-testid="secret-rotate-confirm">
            Save new value
          </Btn>
        </div>
      )}
    </div>
  )
}

function statusColor(status: FactorySecretMetadata['status']): string {
  if (status === 'configured') return tokens.ok
  if (status === 'test_failed') return tokens.err
  if (status === 'missing') return tokens.warn
  return tokens.dim
}
