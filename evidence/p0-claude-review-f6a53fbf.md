# FINDINGS

1. **Prior finding #1 (SIGINT mid-`git commit` → generic error) is correctly fixed** (`packages/cli/src/init/scaffolders/git-init.ts:59-65`). `requireOk` now checks `signal?.aborted` *before* the `result.code` check, so a child that exits non-zero because it received the signal is converted into `initCancelledError()` rather than a generic `Error("interrupted")`. Order of checks matters here and is correct.

2. **Prior finding #2 (`--json` mode had no SIGINT handling) is correctly fixed** (`packages/cli/src/init/structured.ts:19-39`). `withSigintAbort()` wraps the structured flow, the abort signal is threaded into `scaffoldFactory`, and `throwIfAborted` checkpoints sit after `validateWritableDirectory` and after scaffold. Cancellation now propagates through the top-level catch in `commands/init.ts:28-31`, producing the single `init.cancelled` envelope and exit 130 demanded by §0.4 §8.

3. **Prior finding #3 (clack pin / lockfile) cleared on the branch.** `73ba1cc` adds `"@clack/prompts": "1.2.0"` exactly and updates `pnpm-lock.yaml` with 40 lines. Matches D151's pinned version.

4. **Prior finding #6 (defense-in-depth around scaffold) addressed** (`packages/cli/src/init/human.ts:29`). `throwIfAborted(sigint.signal)` immediately after `scaffoldFactory` returns catches the case where SIGINT lands between scaffold completion and the `showScaffolded` UI write. Combined with finding #1's fix in `requireOk`, the cancel path is solid in both modes.

5. **Both happy-path ordering and cancellation are now strongly asserted** (`packages/cli/src/tests/init/command.test.ts:66-71, 104-128`; `tests/init/tui.test.ts:76-100`). Happy-path test uses `toEqual` on the kind sequence — a regression that re-ordered or dropped a kind would fail. Cancellation tests assert exit 130, last envelope is `init.cancelled`, and the project dir is removed from disk. Tests pass (468/468 in `pnpm --filter @ductum/cli test`).

6. **Minor (carryover, non-blocking): `validateWritableDirectory` runs twice in `--json` mode** (`structured.ts:21` and again inside `scaffoldFactory` via `steps/scaffold.ts:34`). Only cosmetic duplication today — both calls run before `init.scaffolded` so envelope ordering is unaffected — but if filesystem state changes between the two checks, the human-visible error code could disagree with the rollback path. Worth a follow-up to lift the inside-scaffold check (or skip the outside one in structured mode).

7. **Minor (non-blocking): `hasConfiguredAuthor` between `git add` and `git commit` does not check `signal.aborted`** (`git-init.ts:16, 51-57`). If SIGINT lands during the two `git config` reads, we proceed to spawn `git commit` before the next `requireOk` catches it. Wastes one extra child process; not a correctness issue.

8. **Spec drift / D147-D148-D151: clean.** D151 supply-chain rules honored (exact pin, lockfile committed, no install scripts added). D148 mandates clack as TUI lib — used. D135 init kinds are registered in the central `event-registry.ts` and exercised by `INIT_EVENT_KINDS`-based tests.

# VERDICT
PASS

# SUGGESTED CMDS
