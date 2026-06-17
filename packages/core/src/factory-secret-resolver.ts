import type { FactorySecretRepo } from './repos/factory-settings-interfaces.js'
import { decryptFactorySecret, loadFactorySecretKey } from './factory-secret-crypto.js'
import { parseFactorySecretRef } from './factory-secret-refs.js'

export interface FactorySecretResolverDeps {
  factoryDir: string
  secrets: Pick<FactorySecretRepo, 'get'>
}

export class FactorySecretResolver {
  constructor(private readonly deps: FactorySecretResolverDeps) {}

  resolve(ref: string): string {
    const secretId = parseFactorySecretRef(ref)
    if (secretId == null) throw new Error('Secret resolution requires a secret:<id> reference')
    const stored = this.deps.secrets.get(secretId)
    if (stored == null) throw new Error(`Secret not found for reference: ${ref}`)
    const key = loadFactorySecretKey(this.deps.factoryDir)
    return decryptFactorySecret(stored.payload, stored.keySource, key)
  }
}
