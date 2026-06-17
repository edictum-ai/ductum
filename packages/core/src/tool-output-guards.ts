/**
 * Call-scale guards for tool outputs (handoff-guard style).
 *
 * The session-scale fix-loop in `post-completion-router.ts` catches
 * *correctness* failures — wrong logic, missing tests, review FAIL.
 * That fix loop spawns a brand new reviewer conversation and costs
 * $0.50 – $3 per round.
 *
 * Call-scale guards catch *structural* failures — missing fields,
 * short summaries, malformed JSON — at the tool call boundary, before
 * the run lands in the DB. The agent sees a structured validation
 * error in the same session, retries the same call with the feedback,
 * and the session-scale fix-loop only fires for real correctness
 * issues that a different agent actually needs to review.
 *
 * Inspired by `handoff-guard-ts`'s `guard(options)(fn)` pattern. Kept
 * deliberately zod-agnostic so @ductum/core doesn't have to pull in
 * a schema library as a runtime dependency — any object with a
 * `safeParse(input)` method that returns the Zod-shaped result is
 * accepted. Zod schemas satisfy this interface natively, so the MCP
 * tool handlers (which already depend on zod) can pass their existing
 * schemas straight through.
 */

/** Single validation issue — mirrors Zod's ZodIssue shape. */
export interface GuardIssue {
  /** Dot-delimited path into the input object (e.g. `"result"`, `"attachments.0.path"`). */
  path: string
  /** Human-readable message — presented to the agent for retry. */
  message: string
}

/**
 * Minimal validator contract. Zod schemas satisfy this — their
 * `safeParse` returns `{ success, data }` or `{ success, error }`.
 * Custom validators (hand-rolled or ajv-backed) can implement this
 * without pulling zod into @ductum/core.
 */
export interface GuardValidator<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | {
        success: false
        error: { issues: Array<{ path: Array<string | number>; message: string }> }
      }
}

export interface GuardOptions<T> {
  /** Validator for the tool output. */
  validator: GuardValidator<T>
  /** Tool name used in error messages. Optional — defaults to "tool output". */
  name?: string
}

export interface GuardSuccess<T> {
  ok: true
  value: T
}

export interface GuardFailure {
  ok: false
  error: {
    /** Top-line message suitable for echoing back to the agent. */
    message: string
    /** Per-field issues with normalized dot-paths. */
    issues: GuardIssue[]
  }
}

export type GuardResult<T> = GuardSuccess<T> | GuardFailure

/**
 * Validate `input` against the guard's validator. Returns a
 * `GuardResult` so callers can decide how to surface failures —
 * MCP tool handlers convert `GuardFailure` into an `isError: true`
 * CallToolResult, HTTP routes convert it into a 400 response body,
 * and the dispatcher's post-completion router converts it into a
 * retry-with-feedback task.
 *
 * Never throws on validation failure — the whole point is to let the
 * caller handle the error path inline. If the validator itself throws
 * (bug in the validator, not a validation failure), that error does
 * propagate up.
 */
export function guardToolOutput<T>(
  options: GuardOptions<T>,
  input: unknown,
): GuardResult<T> {
  const name = options.name ?? 'tool output'
  const result = options.validator.safeParse(input)
  if (result.success) {
    return { ok: true, value: result.data }
  }

  const issues: GuardIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.') || '<root>',
    message: issue.message,
  }))

  const detail = issues
    .map((issue) => (issue.path === '<root>' ? issue.message : `${issue.path}: ${issue.message}`))
    .join('; ')

  return {
    ok: false,
    error: {
      message: `validation failed for ${name}: ${detail}`,
      issues,
    },
  }
}

/**
 * Functional `guard(options)(fn)` pattern mirroring handoff-guard-ts.
 * Wraps an async function so that its INPUT is validated before the
 * function runs. When validation fails the wrapped function returns a
 * `GuardFailure` without invoking the inner function; when it passes
 * the parsed data is forwarded to the inner function and its return
 * value is wrapped in a `GuardSuccess`.
 *
 * Use this for non-MCP surfaces (HTTP routes, CLI commands, direct
 * API calls) where you want the same retriable validation story but
 * don't have MCP's automatic inputSchema checking.
 *
 * For MCP tools the preferred pattern is passing the zod schema to
 * `registerTool`'s `inputSchema` — the MCP framework runs the exact
 * same `safeParse` under the hood and returns the zod issues to the
 * agent automatically.
 */
export function guard<T, R>(
  options: GuardOptions<T>,
  fn: (value: T) => Promise<R> | R,
): (input: unknown) => Promise<GuardSuccess<R> | GuardFailure> {
  return async (input: unknown) => {
    const result = guardToolOutput(options, input)
    if (!result.ok) return result
    const value = await fn(result.value)
    return { ok: true, value }
  }
}
