# FINDINGS

**Security (1-10):**

1. ✅ Codex env sanitized — `sanitizedEnv()` returns only `{PATH, HOME, TERM}`; ANTHROPIC_API_KEY explicitly verified stripped (codex.test.ts:10-19).
2. ✅ Codex stdout/stderr captured in `ProcessResult`; not echoed. Note even mentions "Codex stderr was captured and not printed" (auth-codex.ts:55).
3. ✅ Non-zero exit → `CodexLoginError` → `InitCommandError` w/ suggestedActions (auth-codex.ts:80-89).
4. ✅ Explicit argv arrays everywhere; `spawn` in `storeTokenWithGh` uses array form, no shell:true.
5. ✅ `device_code` lives only in `requestDeviceCode` return → `pollForToken` local. Never persisted.
6. ✅ `intervalSeconds * 1000 + jitter` honored; `slow_down` bumps interval by ≥5s (copilot.ts:124-126). Test verifies sleeps=[5000,10000].
7. ✅ Token piped via stdin to `gh auth login --with-token`; gh manages on-disk storage (mode inherited).
8. ✅ Token never appears in errors: `storeTokenWithGh` resolves with gh's stdout/stderr (not the token); failure throws generic `'GitHub token storage failed.'`. Test "does not include the token in storage failure errors" enforces this.
9. ✅ `MAX_DEVICE_TIMEOUT_MS = 15 * 60_000`, capped against `expires_in` (copilot.ts:114). Timeout throws `auth_copilot_device_code_timeout`; storeToken not called.
10. ✅ Each `loginCopilotWithDeviceFlow` call requests a fresh device_code (test "requests a fresh device_code on each attempt").

**Behavior (WARN-level):**

11. ⚠ **Copilot scope drift**: requests `repo read:org gist` (full repo write + gist) vs contract §2.2 `read:user`. D153 documents the trade-off (gh `--with-token` rejects narrower tokens), but `gist` + `repo` is broad blast-radius for a Copilot enablement step. Consider noting "this token can read/write your repos and gists" in the human note for honesty.
12. ⚠ **Demo evidence gap**: `evidence/p2-codex-copilot-demo.txt` admits neither Codex login OAuth nor Copilot device-code → token exchange completed end-to-end. Only skip path + endpoint reachability proven. D153 acknowledges this; the contract's demo section asks for a real round-trip on a clean machine.
13. ⚠ **`renderNextSteps`** dropped `ductum status` and replaced it with a descriptive sentence ("ductum init can enable…"), which is not a runnable command — odd UX in what's framed as a copy-paste cheat sheet.
14. ⚠ **`pollOnce` doesn't check `response.ok`** before `parseJson`; GitHub 5xx HTML would throw on `response.json()` and bubble as a non-structured error rather than mapping to `auth_copilot_failed`.
15. ⚠ **`shouldOpenBrowser` runtime probe**: `'isTTY' in input.ctx.stdout && input.ctx.stdout.isTTY === true` — fine, but `MemoryWritable` in tests passes `isTTY: true` only via constructor; production stdout is the real tty. No issue, just brittle.
16. ℹ Sleep abort throws `CopilotLoginError('auth_copilot_failed', ...)` rather than a dedicated cancel error; the outer `signal.aborted` check in `runDeviceFlow` correctly remaps to `initCancelledError`. Works, slightly indirect.
17. ℹ Stale comment in scaffold output: `'agents: []   # P1/P2 add Claude / Codex / Copilot entries here'` still references P1/P2 even after P2 ships.
18. ✅ D135: new event kinds registered in `D135_INIT_STREAM_EVENT_KINDS`; structured errors carry `suggestedActions` + `context.reason`.
19. ✅ D152: validation stays CLI-side (`assertFactoryYamlValid` enriched in `factory-yaml.ts`); `@ductum/core` loader untouched.
20. ✅ D132 Anthropic path untouched.
21. ✅ Agent-pickers step requires explicit operator selection — no auto-enable.

# VERDICT
WARN

(All 10 security checks pass; behavior gaps are documented in D153 but the broader-than-spec Copilot scopes and the partial demo are worth surfacing to the operator before merge.)
