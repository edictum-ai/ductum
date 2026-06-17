# FINDINGS

1. **Real Ctrl-C during the git child process produces a generic `"command failed"` error, not `init_cancelled`** (`packages/cli/src/init/scaffolders/git-init.ts:50-55`, `packages/cli/src/init/steps/scaffold.ts:60-64`). When SIGINT lands while `git commit` is running, the child receives it too and exits non-zero. `requireOk` throws `Error(stderr || 'command failed')` *before* the next `checkAbort` runs. The diff's new test (`tests/init/tui.test.ts:78-93`) only passes because the mock `runProcess` synchronously emits SIGINT and then resolves with `code: 0` — an unrealistic shape. In production: rollback happens, but the user sees a generic error and no `init.cancelled` envelope. Contract §0.4 §8 says exactly one `init.cancelled` must fire and exit 130. Fix: in `requireOk` (or around the git calls) re-check `signal.aborted` and throw `initCancelledError()` instead of the generic error.

2. **`--json` (structured) mode has no SIGINT handling at all** (`packages/cli/src/init/structured.ts:1-48`, `packages/cli/src/commands/init.ts:36-44`). `runStructuredInit` never calls `withSigintAbort()` and passes no `signal` to `scaffoldFactory`. Ctrl-C during JSON-mode scaffolding leaves partial files on disk (no rollback runs because nothing throws) and emits no `init.cancelled` envelope. Contract §0.4 §8 / "Partial scaffolding is rolled back" should hold for both output modes.

3. **`@clack/prompts@1.2.0` dep pin + lockfile + D151 audit not visible in this diff** (`packages/cli/package.json`, `pnpm-lock.yaml`). Carryover from prior review. The diff imports `@clack/prompts` extensively but does not show the package.json/lockfile change. Block until verified on the branch.

4. **`event-registry.ts` is a local TS module, not necessarily *the* D135 stream registry** (`packages/cli/src/event-registry.ts:1-27`). Contract §0.4 says "Add to D135's stream registry as part of this PR." If D135's registry lives in `decisions/` or `docs/` or a shared schemas package, this PR only registers in CLI-local code. Confirm where the canonical registry is and that this PR updates it.

5. **`scaffoldFactory` is invoked twice with `validateWritableDirectory`** (`packages/cli/src/init/structured.ts:21-23` calls it, then `steps/scaffold.ts:32` calls it again inside). Carryover; not a bug, but the human-visible error vs rollback path can disagree if env changes between calls.

6. **`rejectOnAbort` only wraps `runInitPrompts`, not `scaffoldFactory`** (`packages/cli/src/init/human.ts:18-26`). Combined with finding #1, scaffolding's SIGINT path relies entirely on `checkAbort` checkpoints between awaits and on `requireOk` not eating the abort. Wrapping the scaffold call too would tighten this.

7. **Welcome `validate` rejects any typed input rather than accepting and discarding** (`packages/cli/src/init/steps/welcome.ts:14-20`). Minor UX: a stray keypress before Enter forces the user to clear the field. The previous review's note (`Press Enter to continue` discards typed input silently) is technically addressed but the new behavior is its own clunkiness.

8. **No test asserts `init.completed` ordering / full envelope sequence on the happy path** (`tests/init/command.test.ts:34-83`). The error-case test now asserts `['init.started', 'error']` (good), but the happy-path test still iterates `INIT_EVENT_KINDS` set-membership rather than asserting order. A regression that emits `init.completed` before `init.scaffolded` would still pass.

9. **`--no-git` in structured mode untested** (`tests/init/command.test.ts`). Human-mode scaffolder test covers `git: false`, structured does not.

# VERDICT
WARN

# SUGGESTED CMDS
git grep -n "signal.aborted\|initCancelledError" packages/cli/src/init
git show HEAD -- packages/cli/package.json pnpm-lock.yaml
git grep -nE "stream(_|-)?registry|D135" decisions docs packages
