import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { lstatSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { FactorySecretEncryptedPayload, FactorySecretKeySource } from './factory-settings-store-types.js'

export const FACTORY_SECRET_ALGORITHM = 'aes-256-gcm'

export interface LoadedFactorySecretKey {
  key: Buffer
  keySource: FactorySecretKeySource
}

export function loadFactorySecretKey(factoryDir: string): LoadedFactorySecretKey {
  const keyPath = join(factoryDir, '.ductum', 'secrets.key')
  const linkStats = safeLstat(keyPath)
  if (linkStats == null) throw new Error('Local secret key file is missing')
  if (linkStats.isSymbolicLink()) throw new Error('Local secret key file must be a regular file')

  const stats = statSync(keyPath)
  if (!stats.isFile()) throw new Error('Local secret key file must be a regular file')
  if (process.platform !== 'win32' && (stats.mode & 0o777) !== 0o600) {
    throw new Error('Local secret key file permissions must be 0600')
  }

  const key = readFileSync(keyPath)
  if (key.byteLength !== 32) throw new Error('Local secret key file must contain exactly 32 bytes')
  return { key, keySource: { type: 'local-file', keyId: secretKeyId(key) } }
}

export function encryptFactorySecret(
  value: string,
  loadedKey: LoadedFactorySecretKey,
): { keySource: FactorySecretKeySource; payload: FactorySecretEncryptedPayload } {
  const nonce = randomBytes(12)
  const cipher = createCipheriv(FACTORY_SECRET_ALGORITHM, loadedKey.key, nonce)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    keySource: loadedKey.keySource,
    payload: {
      algorithm: FACTORY_SECRET_ALGORITHM,
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    },
  }
}

export function decryptFactorySecret(
  payload: FactorySecretEncryptedPayload,
  keySource: FactorySecretKeySource,
  loadedKey: LoadedFactorySecretKey,
): string {
  if (payload.algorithm !== FACTORY_SECRET_ALGORITHM) {
    throw new Error(`Unsupported secret encryption algorithm: ${payload.algorithm}`)
  }
  if (keySource.keyId !== loadedKey.keySource.keyId) {
    throw new Error('Local secret key does not match the encrypted secret payload')
  }
  if (payload.authTag == null) throw new Error('Encrypted secret payload is missing an auth tag')
  const decipher = createDecipheriv(
    FACTORY_SECRET_ALGORITHM,
    loadedKey.key,
    Buffer.from(payload.nonce, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function secretKeyId(key: Buffer): string {
  return `local:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

function safeLstat(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error != null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
