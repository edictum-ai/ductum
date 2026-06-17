# FINDINGS

**Security checklist (all PASS):**

1. ✓ `sanitizedEnv` (codex.ts:55) returns only `PATH`/`HOME`/`TERM`. Test `codex.test.ts:8-19` asserts `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` stripped. Both `loginCodex`, `requireGh`, `gh auth status`, and the `spawn`'d `gh auth login --with-token` all route through `sanitizedEnv`.
2. ✓ Codex stdout/stderr are captured (not inherited). The TUI surfaces only `stderrCaptured: boolean` (auth-codex.ts:46), never the contents.
3. ✓ Non-zero exit → `CodexLoginError` → `InitCommandError` with `code:'auth_codex_failed'` and `suggestedActions` (auth-codex.ts:78-87).
4. ✓ All subprocess invocations use explicit argv arrays via `runProcess`/`execFile` (git-init.ts:36) and `spawn(...,[...])` — no `shell:true`.
5. ✓ `device_code` lives only in the local `device` variable + closure passed to `pollOnce`; never written to disk. `onDeviceCode` callback only exposes `userCode`/`verificationUri`/`expiresInSeconds`.
6. ✓ Polling honors `device.interval ?? 5` and adds bounded jitter (≤250ms). No busy-loop in the happy path.
7. ✓ Token piped to `gh auth login --with-token` over stdin; gh owns storage mode/path. No manual `hosts.yml` write.
8. ✓ Token never appears in any thrown error message, log, note, or returned object. `storeTokenWithGh` captures gh's stdout/stderr but the caller discards them on failure (copilot.ts:86) — a generic "GitHub token storage failed" is thrown.
9. ✓ Polling timeout `Math.min(input.timeoutMs ?? 15min, expires_in*1000, 15min)` — capped at 15min per RFC 8628. Times out → throw `auth_copilot_device_code_timeout`.
10. ✓ Each `loginCopilotWithDeviceFlow` call invokes `requestDeviceCode` afresh — `copilot.test.ts:118-141` asserts two consecutive calls produce `device-1` then `device-2`.

**Behavior / contract:**

11. ✓ All P2 envelope kinds (`init.auth_codex_*`, `init.auth_copilot_*`, `init.agents_selected`) registered in `event-registry.ts` and emitted in both `human.ts` and `structured.ts`.
12. ✓ Drift documented in D153: scope broadened from `read:user` to `repo read:org gist` because gh `--with-token` rejects narrower tokens. Codex-CLI delegation justified there too.
13. ✓ `factoryYaml` agent shape per provider asserted in `assertFactoryYamlValid` (round-trip parse + per-agent shape check). `scaffold.test.ts:79` covers all 3.
14. ✓ Tests cover detected-existing, declined, success (mocked), timeout, gh-not-installed, SIGINT for both Codex and Copilot.

**WARN (behavior / UX, not security):**

W1. `packages/cli/src/login/copilot.ts` is 215 LOC; contract §2.6 budget is ≤200 LOC each in `login/`. File-size gate (300) still passes, but the P2 budget is exceeded. Contract said "split if larger" — a `device-flow.ts` extraction would fit.

W2. `slow_down` handler at copilot.ts:138 — `Math.max(Number(body.interval ?? intervalSeconds + 5), intervalSeconds + 5)`. If GitHub returns `interval` as a non-numeric string, `Number(...)` → `NaN`, `Math.max(NaN, x)` → `NaN`, and `NaN * 1000` becomes `0` in `setTimeout`, busy-looping until the 15-min cap. Defensive: `Number.isFinite(...)` check before use.

W3. Server-emitted `expired_token` falls through to the `auth_copilot_device_code_timeout` error (copilot.ts:141, 144). Functionally similar but the structured code claims "timeout" when GitHub explicitly said "expired" — minor accuracy issue for telemetry.

W4. **Codex acquisition flow is functionally broken in the TUI.** `defaultRunProcess` uses `execFile` (git-init.ts:36) which buffers stdout/stderr and returns only on exit. `codex login` prints the OAuth URL to stdout and waits — but the operator sees only the spinner "Waiting for Codex login" and never sees the URL or `localhost:1455` listener. A real fresh acquisition will hang until the 15-min timeout. The evidence file §2 acknowledges this gap ("not completed non-interactively in this session"), but it applies to interactive runs too. To work, codex needs either inherited stdio or a streaming RunProcess variant.

W5. Structured/non-human `pickInitAgents` (agent-pickers.ts:25-28) auto-enables every authenticated provider with no opt-out signal. Contract §2.3 says "selection is in the agent-pickers step" and the slop-review attacks "any flow that auto-enables agents the operator didn't pick." For non-human callers there's no way to express partial selection — the structured caller would have to omit auth entirely. Acceptable for now (no flag exists), but worth flagging.

W6. D153 widens GitHub scopes well beyond Copilot need (`repo` = read+write to private repos, `read:org`, `gist`). Justified by gh-CLI compatibility, but a future `gh auth login --with-token` change might allow narrower scopes — leave a TODO to revisit.

# VERDICT
WARN

Security contract is satisfied (10/10). Behavior contract is satisfied on paper, but W4 means the Codex acquisition path almost certainly cannot be completed by a real operator in the TUI today — the OAuth URL is buffered and never displayed. Evidence acknowledges no fresh Codex round-trip was completed. This should be addressed before claiming P2 ships an interactive Codex acquisition flow.
