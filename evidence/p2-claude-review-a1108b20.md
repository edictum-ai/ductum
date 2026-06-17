# FINDINGS

## Security correctness
1. **Codex env sanitization (✓ PASS)** — `sanitizedEnv` in `login/codex.ts:58-64` strips everything except `PATH`/`HOME`/`TERM`; both the injected `runProcess` path and direct `spawn` path use it. Test `tests/login/codex.test.ts` explicitly proves `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are filtered.
2. **Codex stdout/stderr handling (✓ PASS)** — `runCodexLoginProcess` captures into local strings and only forwards URLs that pass `isSafeCodexAuthUrl` (allowlist: `auth.openai.com`, `chatgpt.com`, `localhost`, `127.0.0.1`). Step layer reports only a boolean `stderrCaptured`, never echoes contents.
3. **Codex non-zero exit (✓ PASS)** — `loginCodex` throws `CodexLoginError`, wrapped by `auth-codex.ts:authError` into `InitCommandError` with `suggestedActions` (install_codex, rerun_init).
4. **Codex argv only (✓ PASS)** — `spawn('codex', ['login'], { stdio: ['ignore','pipe','pipe'] })`; no `shell: true`.
5. **device_code in memory (✓ PASS)** — never persisted; lives only inside `pollForToken` closure.
6. **Polling cadence (✓ PASS)** — sleep = `intervalSeconds*1000 + jitterMs()`, defaults to 5s, slow_down monotonically increases via `nextSlowDownInterval`. Test verifies sleeps `[5000, 10000]` after slow_down and ignores malformed `interval`.
7. **gh-managed storage (✓ PASS)** — `storeTokenWithGh` pipes token to `gh auth login --with-token` stdin; no manual `hosts.yml` write, mode inherited.
8. **No token in logs/errors (✓ PASS)** — token only flows: device-flow JSON → memory → gh stdin. Storage failure throws generic `'GitHub token storage failed.'`. The `does not include the token in storage failure errors` test confirms.
9. **15-min timeout + cleanup (✓ PASS)** — `MAX_DEVICE_TIMEOUT_MS` capped via `Math.min(...)`; loop exits with `auth_copilot_device_code_timeout` and `storeToken` is never called.
10. **Fresh device_code per attempt (✓ PASS)** — each `loginCopilotWithDeviceFlow` call invokes `requestDeviceCode` again; `requests a fresh device_code on each attempt` test confirms.

## Behavior / contract
- D135 envelope kinds wired correctly in `event-registry.ts:22-30`. Errors carry `auth_*_failed` codes with structured suggestedActions.
- D153 documents the divergence from the literal 2.1 (Codex 3-way menu) and 2.5 (Copilot `.env.local`) contract clauses; this is the explicit drift-handling path the contract requires.
- File-size budget honored: `auth-codex.ts` 94, `auth-copilot.ts` 111, `agent-pickers.ts` 40, `login/codex.ts` 130, `login/copilot.ts` 180, `copilot-process.ts` 46 (split helper). No new grandfather entries.
- D152 honored: validation lives in CLI; no @ductum/core loader changes.

## Minor (non-blocking) WARNs
- `requestDeviceCode`/`pollOnce` don't forward `signal` to `fetch` — abort cancels the next sleep but lets the in-flight request run to completion. Not a credential leak; just slow Ctrl-C.
- `detectExistingCopilot` treats *existence* of `~/.config/gh/hosts.yml` as authenticated. File could exist with no `github.com` entry; would surface as misleading "detected" rather than insecure storage. Cheap fix: parse for a `github.com:` key.
- The exit-demo evidence (`evidence/p2-codex-copilot-demo.txt`) self-discloses the Codex browser round-trip wasn't completed non-interactively. Acceptable, but the contract's "Exit Demo" wall-clock is therefore partial.

# VERDICT
PASS
