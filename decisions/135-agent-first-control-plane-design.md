# D135 — Agent-First Control Plane Design Contract

Date: 2026-05-03

Status: Accepted (design contract; implementations in D136-D145)

## Context

The factory's primary operator is an AI agent (openclaw, hermes-agent,
claude-code, codex), not a human at a keyboard. Every prior session that
designed an "operator-facing" surface — dashboard banners, Telegram DMs,
free-form error strings, ad-hoc evidence payloads — silently assumed a
human consumer. That mismatch is why orchestrator agents fall back to
curl + grep + regex parsing of CLI output: the surfaces aren't shaped
for them.

The next bundle (10 features, codex-direct, D136-D145) ships several new
control-plane surfaces: cancel command, SSE event stream, structured
recovery hints on failures, typed evidence for worktree snapshots,
output-format toggle, etc. Without a single design contract these new
surfaces would each invent their own shape and the agent-first promise
would die in inconsistencies.

This decision pins the contract. Every surface in D136-D145 implements
against it. Existing surfaces are not retrofitted in this bundle; their
follow-ups live in `specs/backlog/agent-first-cli-output.yaml` and ship
incrementally.

## Decision

### 1. Output mode and TTY-aware default

Every CLI command obeys this resolution order, highest first:

1. Per-invocation flag: `--json`, `--ndjson`, or `--human`
2. `DUCTUM_OUTPUT` env var: `auto | json | ndjson | human`
3. Persisted factory config: `factory.cli.outputMode` in `ductum.yaml`
4. Fallback: `auto`

`auto` resolves to `human` when stdout is a TTY, `json` otherwise. This
mirrors `gh`, `kubectl`, `git log` — operators piping or scripting always
get structured output without flags; humans get pretty rendering.

`ductum config --set-output {auto|json|ndjson|human}` writes the factory
config field. `ductum config --get-output` prints the current resolved mode.

### 2. Schema envelope (every JSON response)

Every JSON or NDJSON response from the API or CLI uses this envelope:

```
{
  "schemaVersion": 1,
  "kind": "<resource-or-event-type>",
  "data": { ... },
  "ts": "2026-05-03T12:34:56.789Z"
}
```

Lists wrap the inner array under `data.items` plus `data.nextCursor` when
pagination applies. Streams emit one envelope per line (NDJSON), one
event per envelope.

`schemaVersion` is per-kind. Bumping it is a breaking change documented
in `MIGRATIONS.md` (new file, separate from `db-migrations.ts`). Adding
optional fields does not bump the version. Renaming or removing fields,
or changing semantics, does.

The current bundle uses `schemaVersion: 1` everywhere. Future arcs may
ship version bumps independently.

### 3. Structured error contract

Errors returned from API or CLI always shape as:

```
{
  "schemaVersion": 1,
  "kind": "error",
  "data": {
    "code": "<stable_snake_case_code>",
    "message": "<human-readable summary>",
    "recoverable": true | false,
    "suggestedActions": [
      {
        "kind": "<machine-actionable-action-id>",
        "description": "<human summary>",
        "cmd": "<exact CLI command if applicable>",
        "args": { ... }
      }
    ],
    "context": { ... }
  },
  "ts": "..."
}
```

Codes are stable across versions. Renaming a code is a breaking change.
`suggestedActions` is ordered by recommendation strength. An orchestrator
agent reads `suggestedActions[0].cmd` and may execute it directly; the
`description` is for human renderings and audit trails.

For human output mode, errors render as the `message` plus a "Suggested
next steps:" block listing each `suggestedActions[].description` with the
`cmd` indented underneath.

### 4. SSE event stream

`GET /api/events` opens a server-sent events stream. Headers:

- `Accept: text/event-stream`
- `Authorization: Bearer <operator-token>` (mandatory)
- Optional `Last-Event-ID: <id>` for resume

Each event is one envelope on one line:

```
id: <monotonic-int-or-uuid>
event: <kind>
data: {"schemaVersion":1,"kind":"<kind>","data":{...},"ts":"..."}

```

Event kinds shipped in this bundle (D138):

- `run.dispatched` — new run started, payload includes runId, taskId, agentId
- `run.stage_changed` — stage transition, payload includes from/to/reason
- `run.awaiting_approval` — pendingApproval flipped true
- `run.cancelled` — operator cancel completed, payload includes reason
- `run.failed` — terminal failure, payload includes failReason and full error envelope (#3 shape)
- `run.completed` — stage=done, payload includes branch, commitSha, mergeSha (when present)
- `cost_budget.paused` — D114 pause fired, payload includes runId, projectedSpend, cap
- `cost_budget.extended` — operator extended cap, payload includes new cap
- `slot.auto_closed` — D137 stale-slot GC freed a slot, payload includes runId, reason
- `factory.events_stream_resumed` — heartbeat-ish event every 30s with `lastEventId` so consumers know the stream is alive

Future bundles may add event kinds. Adding kinds is non-breaking.
Removing a kind or changing its payload shape is breaking.

### 5. Cancel state machine semantics

`POST /api/runs/:id/cancel` with body `{"reason": "<text>"}`:

Preconditions: run is non-terminal AND not already at `stage=done`.

Effects (atomic):
1. If a live agent session is bound, the harness adapter's `kill(sessionId, "cancelled")` is invoked.
2. Run is marked `terminalState=cancelled`, `failReason=null`, `recoverable=false`.
3. Worktree is preserved by default (operator can inspect). Pass `--cleanup-worktree` to remove.
4. The dispatcher's in-memory `activeSessions` slot is freed immediately.
5. SSE event `run.cancelled` is emitted with `{runId, reason, worktreePreserved, cleanupAt}`.
6. Evidence row of typed kind `operator.cancel` (#7) is recorded.

The CLI surface is `ductum cancel <runId> --reason <text> [--cleanup-worktree]`.
JSON response uses the standard envelope; `data.run` is the post-cancel
run record; `data.cost` is `{tokensIn, tokensOut, usd}` for the cancelled
run (zero if no charge incurred yet).

Cancel is distinct from `run-close`: `run-close` is for already-dead
runs (operator cleanup); `cancel` is for live work the operator decides
to stop.

### 6. Cost field on every write response

Every command that creates, mutates, or terminates a run includes a
`data.cost` field on success:

```
"cost": {
  "tokensIn": <int>,
  "tokensOut": <int>,
  "usd": <float, 4 decimal places>,
  "perAgent": [{"agentName": "...", "usd": ...}]  // when multi-agent
}
```

Read commands omit the cost field. Failures still include cost (the cost
incurred up to the failure).

### 7. Typed evidence kinds

The evidence schema gains a registered `kind` discriminator alongside
the existing `type` enum. A new `kind: "worktree.snapshot"` payload:

```
{
  "kind": "worktree.snapshot",
  "branch": "<git-branch>",
  "commitSha": "<sha>",
  "diffStat": {"filesChanged": int, "insertions": int, "deletions": int},
  "verifyOutput": {"command": "...", "exitCode": int, "tail": "<last-N-lines>"},
  "timestamp": "..."
}
```

Existing `kind: "harness.failure"` (D133) and the new
`kind: "operator.cancel"` (#5) and `kind: "operator.note"` (existing,
informally) are formalized as part of the typed registry.

The registry lives in `packages/core/src/evidence-kinds.ts`. Each kind
exports a TypeScript type and a runtime validator. The dashboard's
evidence ledger renders against the registry rather than guessing payload
shape.

### 8. Cancellation flag for streams

`ductum events`, `ductum logs`, `ductum queue --watch` and any other
NDJSON stream command honors SIGINT cleanly: emit a final
`{"kind":"stream.closed","data":{"reason":"client_disconnect"}}` envelope
and exit 0. No half-written lines, no orphan processes.

### 9. Implementation rules

- Every new CLI command in D136-D145 implements the output-mode toggle
  via the shared `packages/cli/src/output.ts` helper. The helper gets
  added in D135's first commit (the helper is part of this contract,
  not a per-feature concern).
- Every new API endpoint returns the schema envelope. Use a shared
  `packages/api/src/lib/envelope.ts` helper.
- Every new error path returns the structured error contract (#3) via a
  shared `packages/api/src/lib/errors-structured.ts` helper that wraps
  the existing error classes.
- Tests assert envelope shape, error code stability, and TTY-mode
  behavior (mock `process.stdout.isTTY`).
- The output helper, envelope helper, and structured-error helper land
  as their own initial commit before any feature in the bundle, so
  later commits can rely on them.

### 10. Non-goals for this bundle

These belong to follow-up arcs in `specs/backlog/agent-first-cli-output.yaml`:

- Retrofitting existing CLI commands (only new ones in D136-D145 ship
  agent-first; existing commands keep current shape until their own
  follow-up arc).
- Idempotency keys.
- Pagination cursors on existing list endpoints.
- Field selection (`--fields`).
- `--explain` flag on existing commands.
- Universal `--dry-run` coverage.
- Watch mode for arbitrary commands (the SSE event stream covers the
  most common cases).

## Consequences

- Codex's bundle implements against a single contract; the 10 features
  are consistent rather than each inventing a shape.
- Orchestrator agents (openclaw, hermes, claude-code, codex) get a
  predictable JSON-everywhere surface for new commands and the SSE
  stream.
- Human operators get the same data via TTY-aware pretty rendering.
- The shared helpers (`output.ts`, `envelope.ts`, `errors-structured.ts`)
  become the spine that future arcs (the backlog spec) can retrofit
  existing commands onto.
- Pause/resume is intentionally NOT in the bundle (cancel is enough
  for now); pause's session-binding complexity gets its own arc after
  D121 lands.
- Telegram-as-notification becomes a downstream consumer of the SSE
  stream, not a primary surface. A separate small CLI
  `ductum events --to telegram --bot $TOKEN --chat $CHAT` ships in a
  later bundle.

## References

- D114 budget-cap-as-gate (cost field shape)
- D115 cli-gaps inventory (this bundle closes Gap 1, 2, 3, 9, 10, 11)
- D119 dashboard-as-operator-inbox (the dashboard becomes a renderer
  of the SSE stream + REST API; this contract makes that possible)
- D121 orphaned-session-reattach (separate from cancel; pause depends
  on it)
- D125 pi-revisit (Pi adapter, when it ships, implements against this
  contract too)
- D131 factory-readiness-recovery-closeout (the recovery's exit demo
  is now redefined to live in the bootstrap-redesign arc, which also
  implements against this contract)
- D133 claude-prompt-overflow-detection (the harness.failure evidence
  kind formalized here)
- D134 dispatcher-agent-health-rotation (the slot-freeing semantics
  build on the same dispatcher state-machine)
