import type { BestOfNVerdict } from './bakeoff-outcomes.js'
import type { BestOfNPolicy, Run, Task } from './types.js'

const COST_EPSILON_USD = 0.000001

export interface CandidateRun { task: Task; run: Run }

export type WinnerSelection = { task: Task; run: Run; policySelected: boolean } | { reason: string }

export function selectBakeoffWinner(
  winnerTask: Task,
  verdict: BestOfNVerdict,
  policy: BestOfNPolicy,
  candidateRuns: CandidateRun[],
  canRouteToApproval: (run: Run) => boolean,
): WinnerSelection {
  const selected = candidateRuns.find((candidate) => candidate.task.id === winnerTask.id)
  if (selected == null) return { reason: `winner ${winnerTask.name} has no run for approval` }
  if (policy !== 'cheapest-verified-reviewed') {
    if (!canRouteToApproval(selected.run)) {
      return { reason: `structured verdict winner run is not done: ${winnerTask.name}` }
    }
    return { task: selected.task, run: selected.run, policySelected: false }
  }

  const passed = candidateRuns
    .filter((candidate) => candidate.task.status === 'done')
    .filter((candidate) => verdict.scores.some((score) => score.taskId === candidate.task.id && score.passed))
  if (passed.length === 0) return { reason: 'cheapest-verified-reviewed requires at least one passed candidate' }
  const incomplete = passed.find((candidate) => !canRouteToApproval(candidate.run))
  if (incomplete != null) return { reason: `passed candidate run is not done: ${incomplete.task.name}` }
  const unknownCost = passed.find((candidate) => !Number.isFinite(candidate.run.costUsd) || candidate.run.costUsd <= 0)
  if (unknownCost != null) {
    return { reason: `cheapest-verified-reviewed requires known recorded cost for candidate: ${unknownCost.task.name}` }
  }

  const cheapestCost = Math.min(...passed.map((candidate) => candidate.run.costUsd))
  const cheapest = passed.filter((candidate) => candidate.run.costUsd <= cheapestCost + COST_EPSILON_USD)
  const selectedCheapest = cheapest.find((candidate) => candidate.task.id === winnerTask.id) ?? cheapest[0]
  if (selectedCheapest == null) return { reason: 'cheapest-verified-reviewed could not select a winner' }
  return {
    task: selectedCheapest.task,
    run: selectedCheapest.run,
    policySelected: selectedCheapest.task.id !== winnerTask.id,
  }
}
