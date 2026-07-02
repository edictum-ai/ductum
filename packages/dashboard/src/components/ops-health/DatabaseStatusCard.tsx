import type { OpsHealthDatabase } from '@/api/client'
import { Card, CardHeader, Mono, tokens } from '@/components/signal'
import { formatBytes } from '@/lib/ops-health-format'

export function DatabaseStatusCard({ database }: { database: OpsHealthDatabase }) {
  const schemaLine = formatSchema(database)
  return (
    <Card>
      <CardHeader
        title="Database"
        meta={database.path ?? 'no db path'}
      />
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="State" value={stateLabel(database)} tone={database.exists ? 'ok' : 'warn'} />
          <Field label="Size" value={database.sizeBytes == null ? '—' : formatBytes(database.sizeBytes)} />
          <Field label="Factory state" value={database.factoryState} />
          <Field
            label="Schema"
            value={schemaLine.text}
            tone={schemaLine.tone}
          />
        </div>
        {!('unavailable' in database.schema) && (
          <SchemaDetail database={database} />
        )}
        <div style={{ padding: '8px 10px', border: `1px solid ${tokens.warn}`, borderRadius: 6, color: tokens.warn, fontSize: 12 }}>
          <strong>Backup / restore:</strong> {database.backupRestore.reason}
        </div>
      </div>
    </Card>
  )
}

function SchemaDetail({ database }: { database: OpsHealthDatabase }) {
  if ('unavailable' in database.schema) return null
  const schema = database.schema
  return (
    <div style={{ display: 'grid', gap: 4, padding: 10, border: `1px solid ${tokens.hair}`, borderRadius: 6 }}>
      <Row label="Binary schema version" value={String(schema.binarySchemaVersion)} />
      <Row label="On-disk schema version" value={String(schema.onDiskSchemaVersion)} />
      <Row label="Applied schema version" value={String(schema.appliedSchemaVersion)} />
      <Row label="Head migration" value={schema.headMigrationId ?? '—'} />
      <Row label="Applied migrations" value={String(schema.appliedMigrationIds.length)} />
      {schema.unknownMigrationIds.length > 0 && (
        <Row label="Unknown migrations" value={schema.unknownMigrationIds.join(', ')} tone="err" />
      )}
    </div>
  )
}

function formatSchema(database: OpsHealthDatabase): { text: string; tone: 'ok' | 'warn' | 'err' } {
  if ('unavailable' in database.schema) {
    return { text: 'unavailable', tone: 'warn' }
  }
  if (schemaUnknown(database)) return { text: 'unknown migrations present', tone: 'err' }
  if (!database.schema.current) return { text: 'behind binary', tone: 'warn' }
  return { text: `current (v${database.schema.appliedSchemaVersion})`, tone: 'ok' }
}

function schemaUnknown(database: OpsHealthDatabase): boolean {
  return !('unavailable' in database.schema) && database.schema.unknownMigrationIds.length > 0
}

function stateLabel(database: OpsHealthDatabase): string {
  if (!database.exists) return 'missing on disk'
  return database.factoryState === 'has_factory' ? 'ready' : database.factoryState
}

function Field({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'ok' | 'warn' | 'err' }) {
  const color = tone === 'ok' ? tokens.ok : tone === 'warn' ? tokens.warn : tone === 'err' ? tokens.err : tokens.strong
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: tokens.dim }}>{label}</span>
      <Mono size={12} color={color as string}>{value}</Mono>
    </div>
  )
}

function Row({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'err' }) {
  const color = tone === 'err' ? tokens.err : tokens.mid
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: tokens.dim }}>{label}</span>
      <Mono size={11} color={color as string} style={{ textAlign: 'right', wordBreak: 'break-all' }}>{value}</Mono>
    </div>
  )
}
