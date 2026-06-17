# impl-005: Operational Views

**Status:** Draft
**Priority:** High — transforms dashboard from metadata viewer to operational control panel
**Depends on:** impl-002 (dashboard rewrite), impl-009 (Edictum governance)

**Important:** After impl-009, run stages are Edictum workflow stages
(read-analyze, implement, local-verify, external-review, push-pr, ci-green, done).
Terminal states (failed, stalled) are in Run.terminalState. Approval is at the
external-review stage, not a separate waiting-for-approval Ductum stage.
CI/review status is determined by workflow stage, not parallel latches.

## Problem

The dashboard shows data but doesn't help with daily triage. A dev has to click through multiple pages and mentally reconstruct what happened. The key scenarios are:

1. **Morning triage**: What broke overnight? What's stuck? What finished?
2. **Failed run investigation**: Why did it fail? What was the last thing it did? How many times has this been tried?
3. **Live monitoring**: What step is the agent on? Has it made progress recently?
4. **Approval decision**: Can I approve this without opening 3 tabs?
5. **Project control**: What's active, what's queued, what's the spend?

## Goals

1. Homepage triage with full context per run (project/task/agent/failure reason)
2. Run page failure summary with cause chain and retry lineage
3. Project control panel with active runs, spend, queued work
4. Approval queue with one-glance decision support
5. Command palette for global search (Cmd+K)

## Non-Goals

- Full project management (Jira-level features)
- Real-time streaming of tool output (the activity feed refreshes every 3s, not streaming)
- Custom dashboards or configurable views

## Acceptance Criteria

1. Homepage: each run row shows project/task/agent names, failure reason, retry count
2. Run page: failed/stalled runs show cause chain at top ("stalled → heartbeat timeout → retried")
3. Run page: shows all previous attempts for the same task with links
4. Run page: completion summary shown prominently for done runs (not buried in activity)
5. Project page: shows active runs, failed alerts, queued tasks, total spend
6. Approval queue: each card shows full context (task, PR, CI, tests, agent summary)
7. Cmd+K opens search palette, finds runs/tasks/specs by name/ID
8. Copy buttons on run ID, commit SHA, branch, PR URL
