export type ExtensionKind = 'harness' | 'provider' | 'sandbox' | 'stage' | 'notifier'
export type ExtensionSource = 'built-in' | 'operator-allowlisted'

export interface ExtensionManifest {
  id: string
  kind: ExtensionKind
  source: ExtensionSource
  capabilities: string[]
}

export interface ExtensionRegistration {
  manifest: ExtensionManifest
  loadMessage: string
}

export class ExtensionRegistry {
  private readonly registrations = new Map<string, ExtensionRegistration>()

  register<T extends ExtensionRegistration>(registration: T): T {
    const key = registryKey(registration.manifest.kind, registration.manifest.id)
    if (this.registrations.has(key)) {
      throw new Error(`Duplicate ${registration.manifest.kind} extension: ${registration.manifest.id}`)
    }
    this.registrations.set(key, registration)
    return registration
  }

  list<T extends ExtensionRegistration>(kind?: ExtensionKind): T[] {
    const values = [...this.registrations.values()]
    const filtered = kind == null ? values : values.filter((registration) => registration.manifest.kind === kind)
    return filtered as T[]
  }

  get<T extends ExtensionRegistration>(kind: ExtensionKind, id: string): T | null {
    return (this.registrations.get(registryKey(kind, id)) ?? null) as T | null
  }
}

function registryKey(kind: ExtensionKind, id: string): string {
  return `${kind}:${id}`
}
