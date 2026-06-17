import {
  validateCommandSecrets,
  validateEnvReferenceString,
  validateNoLiteralSecrets,
  type SecretScanIssue,
  type SecretScanTargetField,
} from '@ductum/core'

import { ValidationError } from './errors.js'

export function assertEnvReferenceString(
  value: string | undefined,
  path: string,
  target: SecretScanTargetField,
): void {
  const issues: SecretScanIssue[] = []
  validateEnvReferenceString(value, path, target, issues)
  throwFirstSecretIssue(issues)
}

export function assertCommandHasNoLiteralSecrets(
  value: string | undefined,
  path: string,
  target: SecretScanTargetField,
): void {
  const issues: SecretScanIssue[] = []
  validateCommandSecrets(value, path, target, issues)
  throwFirstSecretIssue(issues)
}

export function assertNoLiteralSecrets(
  value: unknown,
  path: string,
  target: SecretScanTargetField,
  options: { secretContainer?: boolean } = {},
): void {
  const issues: SecretScanIssue[] = []
  validateNoLiteralSecrets(value, path, target, issues, options)
  throwFirstSecretIssue(issues)
}

function throwFirstSecretIssue(issues: SecretScanIssue[]): void {
  const issue = issues[0]
  if (issue != null) throw new ValidationError(`${issue.path} ${issue.message}`)
}
