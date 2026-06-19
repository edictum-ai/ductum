import { useFactorySettings } from '@/api/hooks'
import { Caps, Card, CardHeader, Mono, tokens } from '@/components/signal'
import { AdvancedPanel } from '@/settings/AdvancedPanel'
import { AgentSettingsPanel } from '@/settings/AgentSettingsPanel'
import { RegisterAgentDialog } from '@/components/RegisterAgentDialog'
import { DashboardAccessPanel } from '@/settings/DashboardAccessPanel'
import { FactorySettingsPanel } from '@/settings/FactorySettingsPanel'
import { FactorySettingsView } from '@/settings/FactorySettingsView'
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
            <Mono size={12}>Reconnect the local browser session or pair this browser with a one-time code.</Mono>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: tokens.sans, fontSize: 38, fontWeight: 500, color: tokens.strong, margin: '10px 0 0' }}>
            Factory configuration
          </h1>
          <RegisterAgentDialog />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 20 }}>
        <DashboardAccessPanel
          onSaved={() => void settings.refetch()}
          onCleared={() => void settings.refetch()}
        />
        <FactorySettingsPanel />
        <RuntimeSettingsPanel />
        <SecretsPanel />
        {data != null && <AgentSettingsPanel data={data} />}
        {data != null && <FactorySettingsView data={data} />}
        <AdvancedPanel />
      </div>
    </div>
  )
}

function isOperatorAuthError(error: Error, message: string): boolean {
  const status = (error as { status?: unknown }).status
  return status === 401 || message.includes('Operator token required')
}
