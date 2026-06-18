export type SpecStatus = 'draft' | 'reviewed' | 'approved' | 'implementing' | 'done' | 'failed'
export type TaskStatus = 'pending' | 'blocked' | 'ready' | 'active' | 'done' | 'failed'
export type SpecStrategy = 'normal' | 'best_of_n'
export type TaskStrategyRole = 'normal' | 'candidate' | 'blind_review'
export type WorkflowStage = 'understand' | 'implement' | 'ship' | 'done'
// `paused` (operator freeze) and `frozen` (system halt awaiting operator) are
// halted-but-resumable terminal states: excluded from getActive() and never
// auto-dispatched, but resumable from the durable checkpoint (design/04 §1,§5).
// `quarantined` is a DISTINCT terminal poison state (design/04 §5): a task whose
// retry budget exhausted on a deterministic, non-transient failure. It is NOT
// resumable and NOT redispatched (its task stays 'active', out of the ready
// queue), and it surfaces as an operator-needed inbox item instead of silently
// re-looping. markQuarantined widens a stalled/failed run into this state.
export type TerminalState = 'failed' | 'stalled' | 'cancelled' | 'paused' | 'frozen' | 'quarantined'
export type RunLatchStatus = 'pending' | 'pass' | 'fail'
export type EvidenceType = 'ci' | 'review' | 'test' | 'lint' | 'custom' | 'exit_demo.run'
export type GateType = 'authorize_tool' | 'gate_check'
export type GateEvaluationResult = 'allowed' | 'blocked'
