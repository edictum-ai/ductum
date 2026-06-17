import type { FactoryId } from './types.js'

export interface FactoryHomeViewState {
  factoryId: FactoryId
  homeLastSeenAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface FactoryHomeViewStatePatch {
  homeLastSeenAt: string | null
}
