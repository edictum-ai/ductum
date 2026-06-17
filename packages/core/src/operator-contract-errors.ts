import type { PublicContractIssue } from './operator-contract-types.js'

export class PublicContractError extends Error {
  readonly issues: PublicContractIssue[]

  constructor(message: string, issues: PublicContractIssue[]) {
    super(message)
    this.name = 'PublicContractError'
    this.issues = issues
  }
}

export function publicContractIssue(input: PublicContractIssue): PublicContractIssue {
  return input
}

export function publicContractError(message: string, issues: PublicContractIssue[]): PublicContractError {
  return new PublicContractError(message, issues)
}

export function isPublicContractError(error: unknown): error is PublicContractError {
  return error instanceof PublicContractError
}

export function assertSpecIntakeContainsNoAttempts(input: unknown): void {
  const issues = findSpecIntakeAttemptIssues(input)
  if (issues.length > 0) {
    throw publicContractError('SpecIntake cannot include generated Attempts', issues)
  }
}

export function findSpecIntakeAttemptIssues(input: unknown): PublicContractIssue[] {
  const issues: PublicContractIssue[] = []
  const recordName = readSpecName(input)
  visit(input, '', issues, recordName, new WeakSet<object>())
  return issues
}

export function formatPublicContractIssue(issue: PublicContractIssue): string {
  const record = issue.recordName == null
    ? issue.recordType
    : `${issue.recordType} "${issue.recordName}"`
  const dependency = issue.missingDependency == null
    ? ''
    : ` Missing ${issue.missingDependency.recordType} "${issue.missingDependency.idOrName}".`
  return `${record}: ${issue.humanLabel} at ${issue.fieldPath}.${dependency} ${issue.suggestedAction}`
}

function visit(
  value: unknown,
  path: string,
  issues: PublicContractIssue[],
  recordName: string | undefined,
  seen: WeakSet<object>,
): void {
  if (value == null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, issues, recordName, seen))
    return
  }

  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    const fieldPath = path === '' ? key : `${path}.${key}`
    if (isAttemptKey(key)) {
      issues.push(publicContractIssue({
        recordType: 'SpecIntake',
        recordName,
        fieldPath,
        humanLabel: 'Attempts',
        invalidValue: child,
        suggestedAction: 'Remove Attempts from generator input; Ductum creates Attempts when Tasks start.',
      }))
      continue
    }
    visit(child, fieldPath, issues, recordName, seen)
  }
}

function isAttemptKey(key: string): boolean {
  // Runtime guard for common generated attempt fields in unknown input;
  // the typed WorkPackage/SpecIntake contract is the primary boundary.
  return key === 'attempt' || key === 'attempts' || key === 'Attempt' || key === 'Attempts'
}

function readSpecName(value: unknown): string | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const root = value as Record<string, unknown>
  const spec = root.spec
  if (spec != null && typeof spec === 'object' && !Array.isArray(spec)) {
    const name = (spec as Record<string, unknown>).name
    if (typeof name === 'string') return name
  }
  return undefined
}
