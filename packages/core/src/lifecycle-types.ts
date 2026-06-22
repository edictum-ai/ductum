export const SPEC_STATUSES = ['draft', 'reviewed', 'approved', 'implementing', 'done', 'failed'] as const
export type SpecStatus = typeof SPEC_STATUSES[number]
export const TASK_STATUSES = ['pending', 'blocked', 'ready', 'active', 'done', 'failed'] as const
export type TaskStatus = typeof TASK_STATUSES[number]
export const SPEC_STRATEGIES = ['normal', 'best_of_n'] as const
export type SpecStrategy = typeof SPEC_STRATEGIES[number]
export const TASK_STRATEGY_ROLES = ['normal', 'candidate', 'blind_review'] as const
export type TaskStrategyRole = typeof TASK_STRATEGY_ROLES[number]
export const WORKFLOW_STAGES = ['understand', 'implement', 'ship', 'done'] as const
export type WorkflowStage = typeof WORKFLOW_STAGES[number]
// `paused` (operator freeze) and `frozen` (system halt awaiting operator) are
// halted-but-resumable terminal states: excluded from getActive() and never
// auto-dispatched, but resumable from the durable checkpoint (design/04 §1,§5).
// `quarantined` is a DISTINCT terminal poison state (design/04 §5): a task whose
// retry budget exhausted on a deterministic, non-transient failure. It is NOT
// resumable and NOT redispatched (its task stays 'active', out of the ready
// queue), and it surfaces as an operator-needed inbox item instead of silently
// re-looping. markQuarantined widens a stalled/failed run into this state.
export const TERMINAL_STATES = ['failed', 'stalled', 'cancelled', 'paused', 'frozen', 'quarantined'] as const
export type TerminalState = typeof TERMINAL_STATES[number]
export const RUN_LATCH_STATUSES = ['pending', 'pass', 'fail'] as const
export type RunLatchStatus = typeof RUN_LATCH_STATUSES[number]
export const EVIDENCE_TYPES = ['ci', 'review', 'test', 'lint', 'custom', 'exit_demo.run'] as const
export type EvidenceType = typeof EVIDENCE_TYPES[number]
export const GATE_TYPES = ['authorize_tool', 'gate_check'] as const
export type GateType = typeof GATE_TYPES[number]
export const GATE_EVALUATION_RESULTS = ['allowed', 'blocked'] as const
export type GateEvaluationResult = typeof GATE_EVALUATION_RESULTS[number]
