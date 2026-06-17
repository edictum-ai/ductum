# FINDINGS

1. **No real SIGINT wiring during scaffold** (`packages/cli/src/commands/init.ts:38-47`, `packages/cli/src/init/scaffold.ts:36-58`). The contract says "Ctrl-C during the TUI emits one `init.cancelled` envelope and exits 130. Partial scaffolding is rolled back." The diff only handles cancellation through `@clack/prompts`' cancel symbol (covers prompts) and an `AbortSignal` that's never wired to a real `process.on('SIGINT', …)`. The "rollback" test only succeeds because it injects an `afterMkdir` hook to call `controller.abort()`. A real Ctrl-C between `confirm` and the last `writeFile` will leave a half-scaffolded `~/ductum/factory/` on disk with no `init.cancelled` envelope. Slop check explicitly tells reviewers to attack this.

2. **Spec drift in file layout (no Decision)** (`packages/cli/src/init/`). Contract §0.5 expects `init/steps/welcome.ts`, `init/steps/directory.ts`, `init/steps/project-name.ts`, `init/steps/confirm.ts`, `init/steps/scaffold.ts`, `init/steps/next-steps.ts`, plus `init/scaffolders/factory-yaml.ts` and `init/scaffolders/git-init.ts`. The diff collapses everything into `init/prompts.ts`, `init/scaffold.ts`, `init/factory-yaml.ts`. All files are well under 300 LOC, but the structural deviation lacks a Decision and arguably hurts the "each step is a swappable handler" intent for P1+ extension. Either add a Decision or refactor.

3. **D135 stream registry update missing from diff** (contract §0.4 envelope). Contract says "Add to D135's stream registry as part of this PR." The diff defines `INIT_EVENT_KINDS` locally in `packages/cli/src/init/events.ts:5-11` but I don't see a registry file change. If a central registry exists (per D135), this PR doesn't register the new kinds there. Confirm before merging.

4. **`@clack/prompts` dep + lockfile not in shown diff**. Contract requires `@clack/prompts@1.2.0` + `@clack/core@1.2.0` pinned exactly in `packages/cli/package.json` with lockfile committed and D151 audit. None of those files appear in the diff. Either they were applied separately and not shown, or they were omitted. Block merge until verified.

5. **`-h, --help` may collide with Commander's built-in help** (`packages/cli/src/commands/init.ts:24,29-32`). Commander auto-registers `-h, --help` and short-circuits to `outputHelp()` before the action runs. Re-declaring `.option('-h, --help', …)` without disabling the built-in (`helpOption(false)`) typically still triggers Commander's help printer. The init-command test passes only if the program-level `helpOption(false)` is set in `program.ts` (not visible in the diff). Verify.

6. **Welcome "Press Enter to continue" silently discards typed input** (`packages/cli/src/init/prompts.ts:22-26`, helper at 89-99). `textPrompt` does `value.trim() === '' ? defaultValue : value`. If the user accidentally types a character before pressing Enter, the input is dropped without any feedback. A `note` + key-press helper would fit the "one screen, dismissable with Enter" wording better.

7. **Git author override is opinionated** (`packages/cli/src/init/scaffold.ts:62-71`). `-c user.name=Ductum -c user.email=ductum@example.invalid` overrides whatever the operator already has configured. Contract is silent. For a factory the operator owns, prefer their existing `git config user.*` and only fall back if unset; otherwise the first commit looks foreign on `git log`.

8. **`init_already_initialized` envelope ordering not asserted** (`packages/cli/src/tests/init-command.test.ts:85-100`). Test takes `result.text.trim().split('\n').at(-1)`. A regression that emitted `init.completed` before the error would still pass. Assert the full ordered kind list (`['init.started', 'error']`).

9. **`as unknown as Record<string, unknown>` cast on init.scaffolded** (`packages/cli/src/commands/init.ts:67`). Smells; just give `ScaffoldResult` a structural index signature or hand-build the data.

10. **Slug regex missing single-char positive case in tests** (`packages/cli/src/tests/init-paths.test.ts:30-37`). Regex correctly accepts `a` and rejects `a-`/`-a`, but tests only cover `factory-1` and `Factory 1`. Add tests for the boundary classes the regex was designed to handle.

11. **Double `validateWritableDirectory` calls** (`packages/cli/src/commands/init.ts:62`, `packages/cli/src/init/scaffold.ts:31`). Non-interactive path validates `paths.projectDir`, then `scaffoldFactory` validates again (with potentially a different `runProcess`). Not a bug, but it means the human-visible error message and the rollback path can disagree. Consider plumbing the same validated state through.

# VERDICT
WARN

# SUGGESTED CMDS
git grep -n "helpOption" packages/cli/src
git show HEAD -- packages/cli/package.json pnpm-lock.yaml
git grep -nE "stream(_|-)?registry|D135" packages/cli/src docs decisions
