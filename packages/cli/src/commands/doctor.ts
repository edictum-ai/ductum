import { Command, CommanderError } from 'commander'

import { createAction } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { loadRepairView, renderRepairReport, type RepairView } from './repair.js'

type DoctorStatus = 'clear' | 'attention' | 'blocked'

export function registerDoctorCommand(program: Command, deps: CliProgramDeps) {
  program
    .command('doctor')
    .description('Check setup, readiness, and Attempt recovery prerequisites')
    .action(createAction(deps, async (ctx) => {
      const view = await loadRepairView(ctx)
      const status = doctorStatus(view)
      ctx.write({ status, ...view.report, recovery: view.recovery }, renderDoctorReport(view, status))
      if (ctx.json && status !== 'clear') {
        ctx.stderr.write(`doctor status: ${status}\n`)
        throw new CommanderError(doctorExitCode(status), `doctor_${status}`, `doctor status: ${status}`)
      }
    }))
}

function doctorStatus({ report }: RepairView): DoctorStatus {
  if (report.summary.blockers > 0) return 'blocked'
  if (report.summary.attention > 0) return 'attention'
  return 'clear'
}

function renderDoctorReport(view: RepairView, status: DoctorStatus): string {
  const repairLines = renderRepairReport(view.report, view.recovery).split('\n')
  const detailLines = repairLines[0] === 'Repair' ? repairLines.slice(1) : repairLines
  const lines = ['Doctor', `status: ${status}`, ...detailLines]
  if (status !== 'clear') lines.push('', 'next: ductum repair')
  return lines.join('\n')
}

function doctorExitCode(status: DoctorStatus): number {
  return status === 'blocked' ? 2 : 1
}
