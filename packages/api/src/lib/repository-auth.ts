import { parseFactorySecretRef, type ProjectId } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'

export interface RepositoryAuthRefValidation {
  projectId: ProjectId | null
  authRef: string | undefined
}

export function validateRepositoryAuthRef(
  context: ApiContext,
  input: RepositoryAuthRefValidation,
): void {
  const { projectId, authRef } = input
  if (authRef == null) return
  const secretId = parseFactorySecretRef(authRef)
  if (secretId == null) {
    throw new ValidationError('repository.authRef must be a secret:<id> reference')
  }
  const secret = context.repos.secrets.get(secretId)
  if (secret == null) {
    throw new ValidationError(`repository.authRef references unknown FactorySecret: ${authRef}`)
  }
  if (secret.scope === 'project' && projectId == null) {
    throw new ValidationError('repository.authRef project-scoped FactorySecret cannot be used during project creation')
  }
  if (secret.scope === 'project' && secret.projectId !== projectId) {
    throw new ValidationError('repository.authRef project-scoped FactorySecret must belong to the repository project')
  }
}
