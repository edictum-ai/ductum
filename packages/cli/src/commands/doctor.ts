import { Command, CommanderError } from 'commander'
import type { FactoryDoctorAgentReport, FactoryDoctorReport } from '@ductum/core'

import { createAction } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { loadRepairView, renderRepairReport, type RepairView } from './repair.js'

type DoctorStatus = 'clear' | 'attention' | 'blocked'

export function registerDoctorCommand(program: Command, deps: CliProgramDeps) {
  program
    .command('doctor')
    .description('Check setup, readiness, Provider routes, Harness commands, and Attempt recovery prerequisites')
    .action(createAction(deps, async (ctx) => {
      const [view, factoryDoctor] = await Promise.all([loadRepairView(ctx), ctx.api.getFactoryDoctor()])
      const status = doctorStatus(view, factoryDoctor)
      ctx.writeEnvelope(
        'doctor.report',
        { status, providerHarness: factoryDoctor, ...view.report, recovery: view.recovery },
        renderDoctorReport(view, factoryDoctor, status),
      )
      if (ctx.outputMode !== 'human' && status !== 'clear') {
        ctx.stderr.write(`doctor status: ${status}\n`)
        throw new CommanderError(doctorExitCode(status), `doctor_${status}`, `doctor status: ${status}`)
      }
    }))
}

function doctorStatus({ report }: RepairView, factoryDoctor: FactoryDoctorReport): DoctorStatus {
  if (report.summary.blockers > 0 || factoryDoctor.status === 'blocked') return 'blocked'
  if (report.summary.attention > 0 || factoryDoctor.status === 'deferred') return 'attention'
  return 'clear'
}

function renderDoctorReport(view: RepairView, factoryDoctor: FactoryDoctorReport, status: DoctorStatus): string {
  const repairLines = renderRepairReport(view.report, view.recovery).split('\n')
  const detailLines = repairLines[0] === 'Repair' ? repairLines.slice(1) : repairLines
  const lines = [
    'Doctor',
    `status: ${status}`,
    '',
    renderFactoryDoctor(factoryDoctor),
    ...detailLines,
  ]
  if (status !== 'clear') lines.push('', 'next: ductum repair')
  return lines.join('\n')
}

function renderFactoryDoctor(report: FactoryDoctorReport): string {
  const lines = [
    'Provider / Harness Readiness',
    `status: ${report.status} (ready ${report.summary.ready}, blocked ${report.summary.blocked}, deferred ${report.summary.deferred})`,
    `live smoke: ${report.liveSmoke.status} — ${report.liveSmoke.reason}`,
  ]
  for (const agent of report.agents) lines.push(...renderAgent(agent))
  if (report.agents.length === 0) lines.push('- no assigned agents found')
  return lines.join('\n')
}

function renderAgent(agent: FactoryDoctorAgentReport): string[] {
  return [
    `- ${agent.agentName}: ${agent.status}`,
    `  model: ${agent.modelId} -> ${agent.providerId}/${agent.providerModelId}`,
    `  harness: ${agent.harnessId} (${agent.harnessType})`,
    `  roles: ${agent.assignmentRoles.join(', ') || '(none)'}`,
    ...agent.checks.map((check) => `  - ${check.kind} ${check.status} — ${check.message}`),
  ]
}

function doctorExitCode(status: DoctorStatus): number {
  return status === 'blocked' ? 2 : 1
}
