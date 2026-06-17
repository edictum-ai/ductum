# FINDINGS

**Codex (subprocess delegation) — checks 1–4**
1. ✅ `sanitizedEnv` (login/codex.ts:53–59) restricts subprocess env to `{ PATH, HOME, TERM }`. Anthropic/OpenAI/etc. are dropped. Test `codex.test.ts` line ~7 asserts this explicitly.
2. ✅ `runProcess('codex', ['login'], …)` captures stdout/stderr; `auth-codex.ts` only emits "Codex stderr was captured and not printed." — never echoes content. Spinner error message is a static string.
3. ✅ Non-zero exit → `CodexLoginError` → wrapped in `InitCommandError({ code: 'auth_codex_failed', suggestedActions: [install_codex, rerun_init] })` in `authError()`.
4. ✅ Explicit argv array (`['login']`, `['login','status']`); no shell flag. `runProcess` is the same seam used elsewhere — assumed not shell-mode.

**Copilot device flow — checks 5–10**
5. ✅ `device_code` lives only in `DeviceCodeResponse` in memory; `pollOnce` sends it in body, never persisted. No `writeFile` of the device payload.
6. ✅ `pollForToken` uses `intervalSeconds * 1000 + jitterMs()` (default jitter 0–250 ms, default interval 5 s). Honors server `interval` and `slow_down` (`Math.max(server, current+5)`). Test `polls with server interval plus jitter` confirms 7123 ms cadence from a server `interval: 7`.
7. ✅ Token piped via `gh auth login --with-token` stdin; storage location is gh-managed (`~/.config/gh/hosts.yml` or keyring). Ductum never writes the token to disk itself. No `.env.local` write — D153 documents the deviation from §2.5.
8. ✅ Token never appears in:
   - `onDeviceCode` callback (gets `userCode`/`verificationUri` only).
   - error messages (CopilotLoginError messages are static strings).
   - storage failure path — test `does not include the token in storage failure errors` proves it.
   - The success note says only "Credentials were stored by the GitHub CLI."
9. ✅ `MAX_DEVICE_TIMEOUT_MS = 15 * 60_000` clamped via `Math.min(timeoutMs, expires_in*1000, MAX)`. Loop exits with `auth_copilot_device_code_timeout`. Test verifies storeToken not called on timeout.
10. ✅ Each `loginCopilotWithDeviceFlow` call hits `/login/device/code` for a fresh `device_code`. Test `requests a fresh device_code on each attempt` proves no reuse across invocations.

**Behavior / contract concerns (WARN)**
- ⚠️ **Scope deviation from §2.2**: contract specifies `read:user`; implementation uses `repo read:org gist` (login/copilot.ts:11). D153 documents the why (gh `--with-token` rejects narrower tokens), but the result is broader privileges than P2 promised. Token now has full repo write + org read + gist on the operator's GitHub account purely to enable Copilot. Not a defect — but it's a real user-facing privilege expansion that should be surfaced in the human note, which currently says only "Credentials were stored by the GitHub CLI." A mention of the granted scopes would meet the §2.5 "where I stored your token, how to revoke" spirit better.
- ⚠️ **Codex E2E not actually run in evidence**: `evidence/p2-codex-copilot-demo.txt` §2 admits the operator stopped `codex login` before browser completion. Only the no-auth skip walk and a follow-up `codex login status` are real. The "Codex step: choose 'paste API key', paste real key, key validated" demo from §Exit Demo is not in evidence. Note: the implementation also doesn't include the "paste API key" sub-option from §2.1 — it's pure `codex login` subprocess delegation per D153.
- ⚠️ **Codex stdout/stderr captured, not surfaced**: `runProcess` captures, then the only signal to the user is a spinner. If the real `codex login` prints the OAuth URL to stdout (rather than auto-opening a browser), users will sit at "Waiting for Codex login" with no way to see the URL. Not a security issue; a UX issue that needs operator validation.
- ⚠️ **SIGINT test coverage missing**: §Verification calls for "SIGINT" coverage on each step. `auth-codex-copilot.test.ts` covers detected-existing, declined, success, timeout, gh-not-installed, but no Ctrl-C-mid-poll/mid-login test.
- ℹ️ Minor: `sleep()` in copilot.ts adds an `abort` listener on every poll iteration; on resolve it isn't removed (relies on `{ once: true }` only on abort firing). Not a leak in practice since AbortSignal lives only for the request, but trivially fixed by clearing in the resolve path.
- ℹ️ `spawn('gh', …)` lacks an `'error'` handler — if gh disappears between `--version` check and storage, the promise hangs. The pre-check makes this unlikely; worth a 1-line fix.

**D135 conformance**
- ✅ All new event kinds registered in `event-registry.ts`.
- ✅ Structured errors carry `code`, `recoverable`, `suggestedActions`, `context.reason`.
- ✅ Cancel path (signal-aborted) maps to `initCancelledError()` before emitting partial state.
- ✅ No partial credentials written on cancel — gh-managed storage means cancel before storeToken = nothing written; cancel during sleep rejects.

**D152 / loader scope**
- ✅ Changes confined to `packages/cli`; no `@ductum/core` loader edits. `factory-yaml.ts` validation stays CLI-side.

**File-size budget §2.6**
- ✅ auth-codex.ts ~89 LOC; auth-copilot.ts ~108 LOC; login/codex.ts ~59; login/copilot.ts ~199 (right at cap — any future additions force a split); agent-pickers.ts ~40. All within budget; no grandfather entries.

# VERDICT
WARN

Security checks 1–10 PASS. The WARN is for: (a) GitHub scope expansion beyond what §2.2 specified (documented in D153 but operator should be told what they granted), (b) Codex E2E not honestly verified in evidence — only the skip path and `codex login status` are real, (c) missing SIGINT tests called out in §Verification.

# SUGGESTED CMDS
None blocking. Before merge, recommend:
- Update Copilot success note in `auth-copilot.ts` to enumerate granted scopes (`repo`, `read:org`, `gist`) so §2.5 "where stored / how to revoke" is truthful about privilege level.
- Either complete the Codex browser flow once and append to `evidence/p2-codex-copilot-demo.txt`, or amend the contract/D153 to acknowledge that Codex E2E acquisition is operator-verified out-of-band.
- Add SIGINT-during-poll and SIGINT-during-codex-login tests to satisfy §Verification.
