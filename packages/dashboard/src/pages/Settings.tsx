import { useFactorySettings } from '@/api/hooks'
import type { ReactNode } from 'react'
import { Caps, Card, CardHeader, Mono, tokens } from '@/components/signal'
import { AdvancedPanel } from '@/settings/AdvancedPanel'
import { AgentSettingsPanel } from '@/settings/AgentSettingsPanel'
import { DashboardAccessPanel } from '@/settings/DashboardAccessPanel'
import { FactorySettingsPanel } from '@/settings/FactorySettingsPanel'
import { FactorySettingsView } from '@/settings/FactorySettingsView'
import { NotificationChannelsPanel } from '@/settings/NotificationChannelsPanel'
import { RuntimeSettingsPanel } from '@/settings/RuntimeSettingsPanel'
import { SecretsPanel } from '@/settings/SecretsPanel'
import { errorText } from '@/settings/controls'

export { errorText } from '@/settings/controls'

/**
 * Factory Settings on typed DB/runtime APIs only. The aggregate
 * /api/factory-settings read doubles as the page's auth probe; each panel
 * owns its typed read/write pair. No YAML, no raw config editor.
 */
export function Settings() {
  const settings = useFactorySettings()

  if (settings.isLoading) {
    return <div className="shimmer" style={{ height: 220, borderRadius: 8, background: tokens.sunken }} />
  }

  if (settings.error instanceof Error) {
    const message = errorText(settings.error)
    const isAuth = isOperatorAuthError(settings.error, message)
    if (isAuth) {
      return (
        <div className="fade-in" style={{ padding: '36px 40px 48px', maxWidth: 980, margin: '0 auto' }}>
          <div style={{ marginBottom: 24 }}>
            <Caps>Factory Settings</Caps>
            <h1 style={{ fontFamily: tokens.sans, fontSize: 38, fontWeight: 500, color: tokens.strong, margin: '10px 0 0' }}>
              Reconnect dashboard
            </h1>
            <Mono size={12}>Reconnect locally, or paste a fresh dashboard link in the session panel.</Mono>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 420px) 1fr', gap: 20, alignItems: 'start' }}>
            <DashboardAccessPanel onSaved={() => void settings.refetch()} />
            <Card>
              <CardHeader title="Setup status" tone={tokens.warn} />
              <Mono color={tokens.mid}>{isAuth ? 'Browser session required' : message}</Mono>
            </Card>
          </div>
        </div>
      )
    }
    return <Mono color={tokens.err}>{message}</Mono>
  }

  const data = settings.data
  return (
    <div className="fade-in" style={{ padding: '36px 40px 48px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <Caps>Factory Settings</Caps>
        <h1 style={{ fontFamily: tokens.sans, fontSize: 38, fontWeight: 500, color: tokens.strong, margin: '10px 0 0' }}>
          Factory configuration
        </h1>
      </div>

      <SettingsNav />
      <div style={{ display: 'grid', gap: 28 }}>
        <SettingsSection id="settings-access" title="Dashboard access" meta="browser session">
          <DashboardAccessPanel
            onSaved={() => void settings.refetch()}
            onCleared={() => void settings.refetch()}
          />
        </SettingsSection>
        <SettingsSection id="settings-runtime" title="Editable runtime config" meta="save/apply/restart">
          <FactorySettingsPanel />
          <RuntimeSettingsPanel />
        </SettingsSection>
        <SettingsSection id="settings-agents" title="Agents and routing" meta="model, harness, sandbox, workflow refs">
          {data != null && <AgentSettingsPanel data={data} />}
        </SettingsSection>
        <SettingsSection id="settings-secrets" title="Secrets" meta="factory secret metadata">
          <SecretsPanel />
        </SettingsSection>
        <SettingsSection id="settings-notifications" title="Notifications" meta="delivery channels">
          {data != null && <NotificationChannelsPanel catalogChannels={data.notificationChannels} />}
        </SettingsSection>
        <SettingsSection id="settings-catalog" title="Catalog and workflow gates" meta="read-only loaded records">
          {data != null && <FactorySettingsView data={data} />}
        </SettingsSection>
        <SettingsSection id="settings-diagnostics" title="Diagnostics" meta="advanced operator tools">
          <AdvancedPanel />
        </SettingsSection>
      </div>
    </div>
  )
}

function SettingsNav() {
  const items = [
    ['Dashboard access', '#settings-access'],
    ['Runtime config', '#settings-runtime'],
    ['Agents', '#settings-agents'],
    ['Secrets', '#settings-secrets'],
    ['Notifications', '#settings-notifications'],
    ['Catalog / gates', '#settings-catalog'],
    ['Diagnostics', '#settings-diagnostics'],
  ] as const
  return (
    <nav aria-label="Settings sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
      {items.map(([label, href]) => (
        <a
          key={href}
          href={href}
          style={{
            border: `1px solid ${tokens.rule}`,
            borderRadius: 7,
            color: tokens.mid,
            fontFamily: tokens.mono,
            fontSize: 11,
            padding: '6px 10px',
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  )
}

function SettingsSection({
  id,
  title,
  meta,
  children,
}: {
  id: string
  title: string
  meta: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} style={{ scrollMarginTop: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <Caps>{meta}</Caps>
        <h2 id={`${id}-title`} style={{ fontFamily: tokens.sans, fontSize: 22, fontWeight: 550, color: tokens.strong, margin: '4px 0 0' }}>
          {title}
        </h2>
      </div>
      <div style={{ display: 'grid', gap: 20 }}>{children}</div>
    </section>
  )
}

function isOperatorAuthError(error: Error, message: string): boolean {
  const status = (error as { status?: unknown }).status
  return status === 401 || message.includes('Operator token required')
}
