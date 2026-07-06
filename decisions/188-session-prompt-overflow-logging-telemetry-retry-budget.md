# D188 - Session prompt-overflow: log truth, telemetry, retry budget

Date: 2026-07-06

Status: Accepted

## Context

Issue #282 (P0, blocker:unattended): 8 of 14 dogfood repair rows died
with `prompt_overflow`. D133 already classifies Claude's silent
`subtype: "success"` + empty-result + overflow-text shape as a harness
`prompt_overflow` failure, and `applyAttemptResourceCeilings` maps that
to a retryable `paused-max-turns` ceiling. Three gaps remained:

1. **Log/event label.** `claude.ts` emitted `result: session ended —
   success` and a `{ type: 'completed' }` harness event for every
   `result` message *before* `classifyPromptOverflow` ran, so an
   overflow death showed up in `ductum logs` as a success line. The
   requirement "must not label an overflow death as success in logs or
   results" was violated even though the run record was eventually
   marked Failed.
2. **Telemetry.** Harness `prompt_overflow` evidence carried the
   matched signature and last activity text but NOT the context size
   (tokensIn, maxInputTokensInTurn, turns, costUsd). The dispatcher
   attached `observedTelemetry` to the ceiling hit, but only when the
   ceiling caught it; raw `failed` paths had no size at all.
3. **Retry replay.** `DispatcherRecovery.resume()` spawned a fresh run
   with the default dispatcher prompt. The agent had no warning that
   the prior attempt died from overflow, so it re-read the same huge
   files and re-died. The requirement "a retry must not replay the
   identical unbounded context growth" was not met.

Failures occurred across Claude and Codex harnesses (issue evidence),
so the fix lives in shared harness/dispatcher contracts, not in one
adapter.

## Decision

### Logging truth (gap 1)

The Claude harness's result-message handler now performs the same
overflow + max-turns classification that `buildResult` does, *before*
logging or emitting. When the SDK reports `subtype: "success"` but the
result text or last activity text matches a prompt-overflow signature,
the log line and harness event become:

- log: `result: session ended — prompt_overflow (sdk subtype: success)`
- event: `{ type: 'failed', content: 'prompt_overflow ...' }`

Non-overflow results keep the existing `session ended — <subtype>` line
and `{ type: 'completed' }` event. The terminal classification in
`buildResult` is unchanged; this is purely about what we log/emit for
operators watching `ductum logs`.

### Context-size telemetry (gap 2)

`classifyPromptOverflow`, `classifyCaughtPromptOverflow`, and
`classifySilentMaxTurnsReached` now receive the active session's
telemetry (`tokensIn`, `maxInputTokensInTurn`, `turns`, `costUsd`) and
embed it as `observedContext` in the failure evidence. The dispatcher's
`attempt.resource_ceiling` evidence continues to carry
`observedTelemetry` separately because the cap may trigger even when
the harness did not classify (e.g., ceilings disabled at harness level
but enabled at dispatcher level).

### Retry budget (gap 3)

`DispatchOptions` carries a new `priorAttemptFailure` shape:
`{ failReason: string; tokensIn: number; maxInputTokensInTurn: number;
turns: number }`. `DispatcherRecovery.resume()` populates it from the
prior run + harness evidence before calling `dispatch()`.
`dispatcher-spawn.ts` threads it into `buildDispatcherSystemPrompt`,
which renders a "Previous Attempt Failure" section when set. When the
prior failure was prompt_overflow, the section is explicit:

> The previous attempt died from prompt overflow after consuming ~N
> tokens in a single turn. Do NOT re-read the same large files end to
> end. Use `Read` with `offset`/`limit` for big files, summarize before
> re-reading, and prefer `Grep` + targeted reads over broad
> `Glob`+`Read` cycles. If the work genuinely needs more context than
> the model window allows, split the task and report it.

This is advisory for the agent (consistent with C2 - the workflow gates
are the structural enforcement), but it changes the agent's first move
on retry from "start over" to "be cheap about reads".

## Consequences

- `ductum logs` no longer prints `result: session ended — success` for
  a run that actually died from prompt overflow. The harness event
  stream likewise emits `failed`, not `completed`, for that turn.
- `prompt_overflow` evidence rows include `observedContext` so operators
  reading the run detail see the actual context size that triggered
  the rejection, without digging into per-turn token deltas.
- Retries after prompt_overflow get an explicit "don't replay the
  reads" system-prompt section. This won't stop a determined agent
  from re-reading, but it removes the current silent trap where the
  retry had no idea why the prior attempt died.
- D133's classification contract is preserved; this decision layers
  telemetry, log truth, and retry guidance on top.

## Non-goals

- Compaction / summarization inside a single session. The fix ends the
  session early with preserved evidence (the existing freeze path) and
  makes the retry cheaper. In-session compaction is a separate design
  item and is not added here.
- Per-task read budgets enforced structurally. The system prompt is
  advisory; structural enforcement would need a new gate type and is
  out of scope for #282.
- Changing model routing defaults (#278) or workflow profile format.

## Rollback

Revert the harness + dispatcher-support + dispatcher-recovery +
dispatcher-spawn changes. Frozen prompt_overflow runs stay visible as
Needs Attention; the existing D133 classification still marks the
underlying attempt Failed.
