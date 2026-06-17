import { isFactorySecretRef } from './factory-secret-refs.js'
import { isSafeEnvReference, isSensitivePublicKey } from './public-redaction.js'

type Raw = Record<string, unknown>

const SAFE_CONTAINER_KEYS = new Set(['enabled', 'expose', 'provider', 'source', 'type', 'mode', 'name', 'ref', 'refs'])
const SENSITIVE_ENV_ASSIGNMENT = /(?:^|[\s;])([A-Z_][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|CREDENTIAL)[A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|]+)/g

const SECRET_ISSUE_MESSAGE =
  'must reference an environment variable as ${ENV_VAR} or a Ductum secret as secret:<id>; literal secrets are not stored'

export type SecretScanTargetField =
  | 'Factory'
  | 'Factory Settings'
  | 'Factory Settings.Agent'
  | 'Factory Settings.Model'
  | 'Factory Settings.Harness'
  | 'Factory Settings.Workflow'
  | 'Factory Settings.SandboxProfile'
  | 'Factory Settings.NotificationChannel'
  | 'Project'
  | 'Project.agentAssignments'
  | 'Project.workflowProfile'
  | 'Repository'
  | 'Repository.defaultBranch'
  | 'Repository.branchPrefix'
  | 'Component'
  | 'Task.repositoryId'
  | 'Attempt.snapshot'

export interface SecretScanIssue {
  path: string
  targetField: SecretScanTargetField
  message: string
}

interface SecretScanOptions {
  secretContainer?: boolean
}

export function validateNoLiteralSecrets(
  value: unknown,
  path: string,
  targetField: SecretScanTargetField,
  issues: SecretScanIssue[],
  options: SecretScanOptions = {},
): void {
  scanValue(value, path, targetField, issues, options.secretContainer === true)
}

export function validateEnvReferenceString(
  value: string | undefined,
  path: string,
  targetField: SecretScanTargetField,
  issues: SecretScanIssue[],
): void {
  if (value != null && !isSafeSecretReference(value)) addSecretIssue(path, targetField, issues)
}

export function validateCommandSecrets(
  value: string | undefined,
  path: string,
  targetField: SecretScanTargetField,
  issues: SecretScanIssue[],
): void {
  if (value == null) return
  for (const match of value.matchAll(SENSITIVE_ENV_ASSIGNMENT)) {
    const raw = match[2] ?? ''
    const assignmentValue = stripQuotes(raw)
    if (!isSafeSecretReference(assignmentValue)) addSecretIssue(path, targetField, issues)
  }
}

function scanValue(
  value: unknown,
  path: string,
  targetField: SecretScanTargetField,
  issues: SecretScanIssue[],
  secretContainer: boolean,
): void {
  if (typeof value === 'string') {
    if (secretContainer && !isSafeSecretReference(value)) addSecretIssue(path, targetField, issues)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${path}.${index}`, targetField, issues, secretContainer))
    return
  }
  if (value == null || typeof value !== 'object') return
  scanRecord(value as Raw, path, targetField, issues, secretContainer)
}

function scanRecord(
  value: Raw,
  path: string,
  targetField: SecretScanTargetField,
  issues: SecretScanIssue[],
  secretContainer: boolean,
): void {
  for (const [key, item] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    const childSecret = isSensitivePublicKey(key) || (secretContainer && !isSafeContainerKey(key))
    scanValue(item, childPath, targetField, issues, childSecret)
  }
}

function addSecretIssue(
  path: string,
  targetField: SecretScanTargetField,
  issues: SecretScanIssue[],
): void {
  issues.push({
    path,
    targetField,
    message: SECRET_ISSUE_MESSAGE,
  })
}

function isSafeContainerKey(key: string): boolean {
  return SAFE_CONTAINER_KEYS.has(key.toLowerCase())
}

function isSafeSecretReference(value: string): boolean {
  return isSafeEnvReference(value) || isFactorySecretRef(value)
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}
