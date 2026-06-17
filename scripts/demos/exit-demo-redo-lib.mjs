import { createHash } from 'node:crypto'

export const EXIT_DEMO_PHASES = [
  'install_g',
  'init_anthropic_auth',
  'serve_ready',
  'spec_imported',
  'run_awaiting_approval',
  'approve_clicked',
  'merged',
]

export const SAMPLE_PROMPT_TEXT = [
  'Append the line `Bootstrap proof: hello from Ductum.` to `README.md`.',
  'Place it at the end of the file as a single new line.',
  'After editing, verify the diff shows only that one appended line.',
  'Do not touch any other file.',
].join('\n')

export class ExitDemoError extends Error {
  constructor(code, message, context = {}) {
    super(message)
    this.name = 'ExitDemoError'
    this.code = code
    this.context = context
  }
}

export function envelope(kind, data, now = () => new Date()) {
  return { schemaVersion: 1, kind, data, ts: now().toISOString() }
}

export function errorEnvelope(code, message, context = {}, now = () => new Date()) {
  return envelope('error', {
    code,
    message,
    recoverable: recoverableError(code),
    suggestedActions: suggestedActions(code),
    context,
  }, now)
}

export function forbiddenEnvFindings(env, claudeDirExists = false) {
  const findings = Object.entries(env)
    .filter(([key, value]) => value != null && String(value).trim() !== '' && forbiddenEnvKey(key))
    .map(([key]) => ({ kind: 'env', name: key }))
  if (claudeDirExists) findings.push({ kind: 'path', name: '~/.claude' })
  return findings.sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name))
}

export function machineSignature(input) {
  return {
    osHash: hashValue(`${input.platform}:${input.release}`),
    osPlatform: input.platform,
    hostnameHash: hashValue(input.hostname),
  }
}

export function hashValue(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function buildExitDemoEvidence(input) {
  const totalMs = input.totalMs ?? input.timeline.at(-1)?.t ?? 0
  return {
    kind: 'exit_demo.run',
    schemaVersion: 1,
    data: {
      demoName: 'bootstrap-redesign-p5',
      machineSignature: input.machineSignature,
      timeline: input.timeline,
      totalSeconds: totalMs / 1000,
      mergedCommitSha: input.mergedCommitSha,
      mergedBranch: input.mergedBranch ?? 'main',
      agentName: input.agentName ?? 'claude-builder',
      promptText: SAMPLE_PROMPT_TEXT,
      operatorActions: ['browser_auth', 'approve_click'],
    },
  }
}

export function validateExitDemoEvidence(payload, { budgetSeconds = 600 } = {}) {
  const data = payload?.data
  if (payload?.kind !== 'exit_demo.run' || payload?.schemaVersion !== 1 || data == null) {
    throw new ExitDemoError('exit_demo_missing_checkpoint', 'exit demo evidence envelope is invalid')
  }
  validateTimeline(data.timeline)
  if (!isNonEmptyString(data.mergedCommitSha) || !isNonEmptyString(data.mergedBranch)) {
    throw new ExitDemoError('exit_demo_no_merge', 'exit demo did not record a merged commit')
  }
  if (data.mergedBranch !== 'main') {
    throw new ExitDemoError('exit_demo_no_merge', 'exit demo merge did not land on main', { branch: data.mergedBranch })
  }
  if (!Array.isArray(data.operatorActions) || data.operatorActions.join('\0') !== 'browser_auth\0approve_click') {
    throw new ExitDemoError('exit_demo_missing_checkpoint', 'exit demo operator actions are incomplete')
  }
  if (!Number.isFinite(data.totalSeconds) || data.totalSeconds < 0) {
    throw new ExitDemoError('exit_demo_missing_checkpoint', 'exit demo totalSeconds is invalid')
  }
  if (data.totalSeconds >= budgetSeconds) {
    throw new ExitDemoError('exit_demo_budget_exceeded', 'exit demo exceeded the 10 minute budget', {
      totalSeconds: data.totalSeconds,
      budgetSeconds,
    })
  }
  return payload
}

export function findApiProcessFromPsOutput(psOutput, factoryDir) {
  const dbArg = `${factoryDir.replace(/\/+$/, '')}/ductum.db`
  for (const line of psOutput.split('\n')) {
    if (!line.includes('--db') || !line.includes(dbArg)) continue
    if (!line.includes('dist/api/index.js') && !line.includes('packages/api/dist/index.js')) continue
    const match = line.match(/--host\s+(\S+).*--port\s+(\d+)/) ?? line.match(/--port\s+(\d+).*--host\s+(\S+)/)
    if (match == null) continue
    const host = /^\d+$/.test(match[1]) ? match[2] : match[1]
    const port = /^\d+$/.test(match[1]) ? match[1] : match[2]
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') continue
    return { apiUrl: `http://${host}:${port}`, port: Number(port), command: line.trim() }
  }
  return null
}

export function selectFirstAwaitingApprovalRun(records, specName = 'hello-readme') {
  return records.find((record) =>
    record?.derivedStage === 'awaiting_approval'
    && (record?.spec?.name === specName || record?.task?.name === 'P1-HELLO-README'),
  ) ?? null
}

export function selectMergedRunStatus(statusPayload) {
  const run = statusPayload?.run
  if (run?.stage !== 'done' || !isNonEmptyString(run.commitSha)) return null
  return {
    mergedCommitSha: run.commitSha,
    mergedBranch: run.branch ?? 'main',
    agentName: statusPayload?.record?.agent?.name ?? run.agentId,
  }
}

function validateTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length !== EXIT_DEMO_PHASES.length) {
    throw new ExitDemoError('exit_demo_missing_checkpoint', 'exit demo timeline is missing checkpoints')
  }
  let previous = -1
  for (let index = 0; index < EXIT_DEMO_PHASES.length; index += 1) {
    const item = timeline[index]
    if (item?.phase !== EXIT_DEMO_PHASES[index] || !Number.isFinite(item.t) || item.t < 0 || item.t < previous) {
      throw new ExitDemoError('exit_demo_missing_checkpoint', 'exit demo timeline checkpoints are invalid', {
        expected: EXIT_DEMO_PHASES[index],
        actual: item?.phase,
      })
    }
    previous = item.t
  }
}

function forbiddenEnvKey(key) {
  return key.startsWith('ANTHROPIC_')
    || key.startsWith('OPENAI_')
    || key.startsWith('COPILOT_')
    || key === 'GH_TOKEN'
    || key === 'GITHUB_TOKEN'
    || key === 'CLAUDE_CONFIG_DIR'
    || key === 'CLAUDE_CODE_OAUTH_TOKEN'
    || key === 'ZAI_API_KEY'
    || key === 'OPENROUTER_API_KEY'
}

function suggestedActions(code) {
  if (code === 'exit_demo_pre_existing_creds') return [{ kind: 'fresh_machine', description: 'Rerun on a fresh account, VM, or container with no ambient model credentials.' }]
  if (code === 'exit_demo_budget_exceeded') return [{ kind: 'diagnose_timing', description: 'Keep the evidence, document the slow phase, and do not close the recovery claim.' }]
  if (code === 'exit_demo_evidence_write_failed') return [{ kind: 'inspect_ledger', description: 'Inspect the factory API log and rerun the evidence attach step.' }]
  return [{ kind: 'rerun_demo', description: 'Fix the named blocker, then rerun the exit demo from t0.' }]
}

function recoverableError(code) {
  return !['exit_demo_budget_exceeded', 'exit_demo_no_merge', 'exit_demo_evidence_write_failed'].includes(code)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}
