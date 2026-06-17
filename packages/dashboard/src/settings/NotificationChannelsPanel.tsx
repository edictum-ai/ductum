import { useState, type ReactNode } from 'react'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'

import type { NotificationChannelResource, NotificationChannelResourceInput } from '@/api/client'
import type { FactorySettingsNotificationChannel } from '@/api/factory-settings-types'
import {
  useCreateNotificationChannelResource,
  useDeleteNotificationChannelResource,
  useNotificationChannelResources,
  useUpdateNotificationChannelResource,
} from '@/api/hooks'
import { Btn, Card, CardHeader, Mono, tokens } from '@/components/signal'
import { Field, errorText, fieldStyle } from '@/settings/controls'

interface Draft {
  name: string
  enabled: boolean
  botToken: string
  chatId: string
  webhookSecret: string
  publicBaseUrl: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  enabled: false,
  botToken: '',
  chatId: '',
  webhookSecret: '',
  publicBaseUrl: '',
}

export function NotificationChannelsPanel({
  catalogChannels,
}: {
  catalogChannels: FactorySettingsNotificationChannel[]
}) {
  const resources = useNotificationChannelResources()
  const createChannel = useCreateNotificationChannelResource()
  const updateChannel = useUpdateNotificationChannelResource()
  const deleteChannel = useDeleteNotificationChannelResource()
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const busy = createChannel.isPending || updateChannel.isPending || deleteChannel.isPending
  const error = createChannel.error ?? updateChannel.error ?? deleteChannel.error
  const rows = resources.data ?? []

  function saveNew() {
    setNotice(null)
    createChannel.mutate(toInput(newDraft), {
      onSuccess: () => {
        setNewDraft(EMPTY_DRAFT)
        setNotice('channel saved')
      },
    })
  }

  function saveExisting(resource: NotificationChannelResource) {
    const draft = editDrafts[resource.id] ?? fromResource(resource)
    setNotice(null)
    updateChannel.mutate({ id: resource.id, body: toInput(draft) }, {
      onSuccess: () => {
        setEditingId(null)
        setNotice('channel saved')
      },
    })
  }

  function remove(resource: NotificationChannelResource) {
    if (confirmDeleteId !== resource.id) {
      setConfirmDeleteId(resource.id)
      return
    }
    setNotice(null)
    deleteChannel.mutate(resource.id, {
      onSuccess: () => {
        setConfirmDeleteId(null)
        setNotice('channel deleted')
      },
    })
  }

  return (
    <Card style={{ minWidth: 0 }}>
      <CardHeader
        title="Notification channels"
        meta="approval delivery"
        action={
          <span data-testid="notification-channel-status">
            {busy && <Mono size={11} color={tokens.dim}>working…</Mono>}
            {!busy && error != null && <Mono size={11} color={tokens.err}>{errorText(error)}</Mono>}
            {!busy && error == null && notice != null && <Mono size={11} color={tokens.ok}>{notice}</Mono>}
          </span>
        }
      />
      {resources.error != null ? (
        <Mono color={tokens.err}>{errorText(resources.error)}</Mono>
      ) : rows.length === 0 ? (
        <Mono color={tokens.faint}>{resources.isLoading ? 'loading…' : 'No channels'}</Mono>
      ) : (
        rows.map((resource, index) => {
          const draft = editDrafts[resource.id] ?? fromResource(resource)
          const editing = editingId === resource.id
          return (
            <div key={resource.id} style={{ padding: '11px 0', borderTop: index === 0 ? 'none' : `1px solid ${tokens.hair}` }}>
              {editing ? (
                <ChannelForm
                  draft={draft}
                  setDraft={(next) => setEditDrafts((current) => ({ ...current, [resource.id]: next }))}
                  busy={busy}
                  submitLabel={<IconText icon={<Save size={13} />}>Save</IconText>}
                  testId={`notification-channel-edit-${resource.name}`}
                  onSubmit={() => saveExisting(resource)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ChannelRow
                  resource={resource}
                  draft={draft}
                  status={statusFor(resource, catalogChannels)}
                  confirmingDelete={confirmDeleteId === resource.id}
                  busy={busy}
                  onEdit={() => {
                    setEditDrafts((current) => ({ ...current, [resource.id]: fromResource(resource) }))
                    setEditingId(resource.id)
                  }}
                  onDelete={() => remove(resource)}
                />
              )}
            </div>
          )
        })
      )}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${tokens.hair}` }}>
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginBottom: 10 }}>Add Telegram channel</Mono>
        <ChannelForm
          draft={newDraft}
          setDraft={setNewDraft}
          busy={busy}
          submitLabel={<IconText icon={<Plus size={13} />}>Add channel</IconText>}
          testId="notification-channel-create"
          onSubmit={saveNew}
        />
      </div>
    </Card>
  )
}

function ChannelRow({
  resource,
  draft,
  status,
  confirmingDelete,
  busy,
  onEdit,
  onDelete,
}: {
  resource: NotificationChannelResource
  draft: Draft
  status: { text: string; color: string }
  confirmingDelete: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div data-testid={`notification-channel-row-${resource.name}`} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontFamily: tokens.sans, fontSize: 14, color: tokens.strong }}>{resource.name}</span>
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 2, overflowWrap: 'anywhere' }}>
          telegram · {draft.publicBaseUrl || 'no public URL'} · {draft.chatId || 'no chat'}
        </Mono>
      </div>
      <Mono size={11.5} color={status.color}>{status.text}</Mono>
      <Btn small onClick={onEdit} disabled={busy} aria-label={`Edit ${resource.name}`}><IconText icon={<Pencil size={13} />}>Edit</IconText></Btn>
      <Btn small danger onClick={onDelete} disabled={busy} aria-label={`${confirmingDelete ? 'Confirm delete' : 'Delete'} ${resource.name}`}>
        <IconText icon={confirmingDelete ? <X size={13} /> : <Trash2 size={13} />}>{confirmingDelete ? 'Confirm' : 'Delete'}</IconText>
      </Btn>
    </div>
  )
}

function ChannelForm({
  draft,
  setDraft,
  busy,
  submitLabel,
  testId,
  onSubmit,
  onCancel,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  busy: boolean
  submitLabel: ReactNode
  testId: string
  onSubmit: () => void
  onCancel?: () => void
}) {
  const invalid = draft.name.trim() === '' || (draft.enabled && requiredRefs(draft).length > 0)
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  return (
    <div data-testid={testId} style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        <Mono size={11} color={draft.enabled ? tokens.ok : tokens.faint}>enabled</Mono>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
        <Field label="name"><input data-testid={`${testId}-name`} value={draft.name} onChange={(event) => set({ name: event.target.value })} style={fieldStyle} /></Field>
        <Field label="bot token ref" hint="Use ${ENV_VAR} or secret:<id>; plaintext tokens are rejected">
          <input data-testid={`${testId}-botToken`} value={draft.botToken} onChange={(event) => set({ botToken: event.target.value })} style={fieldStyle} autoComplete="off" />
        </Field>
        <Field label="chat ID"><input data-testid={`${testId}-chatId`} value={draft.chatId} onChange={(event) => set({ chatId: event.target.value })} style={fieldStyle} autoComplete="off" /></Field>
        <Field label="webhook secret ref" hint="Use ${ENV_VAR} or secret:<id>; plaintext secrets are rejected">
          <input data-testid={`${testId}-webhookSecret`} value={draft.webhookSecret} onChange={(event) => set({ webhookSecret: event.target.value })} style={fieldStyle} autoComplete="off" />
        </Field>
        <Field label="public base URL"><input data-testid={`${testId}-publicBaseUrl`} value={draft.publicBaseUrl} onChange={(event) => set({ publicBaseUrl: event.target.value })} style={fieldStyle} autoComplete="off" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {invalid && <Mono size={11} color={tokens.warn}>{draft.name.trim() === '' ? 'name required' : `${requiredRefs(draft).join(', ')} required`}</Mono>}
        {onCancel != null && <Btn small ghost onClick={onCancel} disabled={busy}>Cancel</Btn>}
        <Btn small primary onClick={onSubmit} disabled={busy || invalid} data-testid={`${testId}-submit`}>{submitLabel}</Btn>
      </div>
    </div>
  )
}

function statusFor(resource: NotificationChannelResource, catalogChannels: FactorySettingsNotificationChannel[]): { text: string; color: string } {
  const draft = fromResource(resource)
  if (!draft.enabled) return { text: 'disabled', color: tokens.faint }
  const missing = requiredRefs(draft)
  if (missing.length > 0) return { text: 'missing fields', color: tokens.warn }
  const catalog = catalogChannels.find((channel) => channel.id === resource.id || channel.name === resource.name)
  return { text: catalog?.configured === false ? 'not configured' : 'configured', color: tokens.ok }
}

function fromResource(resource: NotificationChannelResource): Draft {
  const config = resource.spec.config ?? {}
  return {
    name: resource.name,
    enabled: config.enabled !== false,
    botToken: publicString(config.botToken),
    chatId: publicString(config.chatId),
    webhookSecret: publicString(config.webhookSecret),
    publicBaseUrl: publicString(config.publicBaseUrl),
  }
}

function toInput(draft: Draft): NotificationChannelResourceInput {
  const config = Object.fromEntries(Object.entries({
    enabled: draft.enabled,
    botToken: clean(draft.botToken),
    chatId: clean(draft.chatId),
    webhookSecret: clean(draft.webhookSecret),
    publicBaseUrl: clean(draft.publicBaseUrl),
  }).filter(([, value]) => value !== undefined))
  return { name: draft.name.trim(), spec: { backend: 'telegram', config } }
}

function requiredRefs(draft: Draft): string[] {
  return [
    draft.botToken.trim() === '' ? 'bot token ref' : null,
    draft.chatId.trim() === '' ? 'chat ID' : null,
    draft.webhookSecret.trim() === '' ? 'webhook secret ref' : null,
  ].filter((item): item is string => item != null)
}

function publicString(value: unknown): string {
  return typeof value === 'string' && value !== '[redacted]' ? value : ''
}

function clean(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function IconText({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{icon}{children}</span>
}
