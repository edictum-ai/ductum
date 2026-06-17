import type { ProjectId } from '../types.js'
import type { FactorySecretMetadata } from '../factory-settings-types.js'
import type {
  FactorySecretCreateInput,
  FactorySecretEncryptedPayload,
  FactorySecretKeySource,
  FactorySecretStoredRecord,
} from '../factory-settings-store-types.js'
import type { FactorySecretRepo } from './factory-settings-interfaces.js'
import { assertChanges, assertFound, toIsoString, type SqliteDatabase } from './utils.js'

interface SecretRow {
  id: string
  name: string
  scope: FactorySecretMetadata['scope']
  project_id: string | null
  description: string | null
  status: FactorySecretMetadata['status']
  key_source_type: 'local-file'
  key_source_id: string
  last_rotated_at: string | null
  last_tested_at: string | null
  created_at: string
  updated_at: string
}

interface PayloadRow {
  secret_id: string
  algorithm: string
  ciphertext: string
  nonce: string
  auth_tag: string | null
}

export class SqliteFactorySecretRepo implements FactorySecretRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(filters: { projectId?: ProjectId | null } = {}): FactorySecretMetadata[] {
    const where = filters.projectId === undefined
      ? ''
      : filters.projectId == null ? 'WHERE project_id IS NULL' : 'WHERE project_id = ?'
    const values = filters.projectId == null ? [] : [filters.projectId]
    return this.db
      .prepare(`SELECT * FROM factory_secret_metadata ${where} ORDER BY name`)
      .all(...values)
      .map((row) => mapMetadata(row as SecretRow))
  }

  getMetadata(id: string): FactorySecretMetadata | null {
    const row = this.db.prepare('SELECT * FROM factory_secret_metadata WHERE id = ?').get(id) as SecretRow | undefined
    return row == null ? null : mapMetadata(row)
  }

  get(id: string): FactorySecretStoredRecord | null {
    const row = this.db.prepare('SELECT * FROM factory_secret_metadata WHERE id = ?').get(id) as SecretRow | undefined
    if (row == null) return null
    const payload = this.db
      .prepare('SELECT * FROM factory_secret_payloads WHERE secret_id = ?')
      .get(id) as PayloadRow | undefined
    return {
      ...mapMetadata(row),
      projectId: row.project_id as ProjectId | null,
      description: row.description,
      keySource: { type: row.key_source_type, keyId: row.key_source_id },
      payload: mapPayload(assertFound(payload, `Secret payload not found: ${id}`)),
    }
  }

  create(input: FactorySecretCreateInput): FactorySecretStoredRecord {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO factory_secret_metadata (
          id, name, scope, project_id, description, status, key_source_type,
          key_source_id, last_rotated_at, last_tested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.name,
        input.scope,
        input.projectId,
        input.description,
        input.status,
        input.keySource.type,
        input.keySource.keyId,
        input.lastRotatedAt,
        input.lastTestedAt,
      )
      insertPayload(this.db, input.id, input.payload)
    })()
    return this.getRequired(input.id)
  }

  updateMetadata(
    id: string,
    fields: Partial<Pick<FactorySecretStoredRecord, 'name' | 'description' | 'status' | 'lastRotatedAt' | 'lastTestedAt'>>,
  ): FactorySecretStoredRecord {
    return this.update(id, fields)
  }

  update(
    id: string,
    fields: Partial<Pick<FactorySecretStoredRecord, 'name' | 'description' | 'status' | 'lastRotatedAt' | 'lastTestedAt'>>
      & { keySource?: FactorySecretKeySource; payload?: FactorySecretEncryptedPayload },
  ): FactorySecretStoredRecord {
    const current = this.getRequired(id)
    this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE factory_secret_metadata
          SET name = ?,
              description = ?,
              status = ?,
              key_source_type = ?,
              key_source_id = ?,
              last_rotated_at = ?,
              last_tested_at = ?,
              updated_at = datetime('now')
          WHERE id = ?
      `).run(
        fields.name ?? current.name,
        fields.description === undefined ? current.description : fields.description,
        fields.status ?? current.status,
        fields.keySource?.type ?? current.keySource.type,
        fields.keySource?.keyId ?? current.keySource.keyId,
        fields.lastRotatedAt === undefined ? current.lastRotatedAt : fields.lastRotatedAt,
        fields.lastTestedAt === undefined ? current.lastTestedAt : fields.lastTestedAt,
        id,
      )
      assertChanges(result.changes, `Secret not found: ${id}`)
      if (fields.payload != null) updatePayload(this.db, id, fields.payload)
    })()
    return this.getRequired(id)
  }

  delete(id: string): void {
    const result = this.db.prepare('DELETE FROM factory_secret_metadata WHERE id = ?').run(id)
    assertChanges(result.changes, `Secret not found: ${id}`)
  }

  private getRequired(id: string): FactorySecretStoredRecord {
    return assertFound(this.get(id), `Secret not found: ${id}`)
  }
}

function insertPayload(db: SqliteDatabase, id: string, payload: FactorySecretEncryptedPayload): void {
  db.prepare(`
    INSERT INTO factory_secret_payloads (secret_id, algorithm, ciphertext, nonce, auth_tag)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, payload.algorithm, payload.ciphertext, payload.nonce, payload.authTag)
}

function updatePayload(db: SqliteDatabase, id: string, payload: FactorySecretEncryptedPayload): void {
  const result = db.prepare(`
    UPDATE factory_secret_payloads
      SET algorithm = ?,
          ciphertext = ?,
          nonce = ?,
          auth_tag = ?,
          updated_at = datetime('now')
      WHERE secret_id = ?
  `).run(payload.algorithm, payload.ciphertext, payload.nonce, payload.authTag, id)
  assertChanges(result.changes, `Secret payload not found: ${id}`)
}

function mapMetadata(row: SecretRow): FactorySecretMetadata {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    status: row.status,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
    lastRotatedAt: toIsoString(row.last_rotated_at),
    lastTestedAt: toIsoString(row.last_tested_at),
  }
}

function mapPayload(row: PayloadRow): FactorySecretEncryptedPayload {
  return {
    algorithm: row.algorithm,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authTag: row.auth_tag,
  }
}
