# P1 Claude Review — Init Auth Slice

Command:

```sh
claude -p --model claude-opus-4-7 "<strict P1 staged-diff review prompt>"
```

Review prompt included the P1 mandatory FAIL checklist:

1. PKCE state parameter generated with crypto-secure RNG and validated on callback
2. code_verifier length 43-128 chars, generated with crypto.randomBytes
3. code_challenge = base64url(sha256(code_verifier)), no shortcuts
4. Redirect URI exact-match validated (no startsWith, regex, etc.)
5. Token storage path is ~/.claude/.credentials.json (or $CLAUDE_CONFIG_DIR), permissions 0600, atomic write
6. No token in logs, errors, evidence, or any output stream
7. Callback server: 127.0.0.1 only, 5 min max lifetime, single-shot accept then close
8. Browser-open URL: PKCE auth URL only (no leaked secrets)
9. Callback success page does not echo the token
10. code_verifier NOT reused across attempts in one session

## Review Output

I have everything I need. Reviewing security items 1-10 against the diff and referenced code (`pkce-core.ts`, `claude-credentials.ts`, `auth-anthropic.ts`, `open-browser.ts`).

## Security review (items 1–10)

1. **PKCE state**: `randomBytes(32)` -> `base64url`; validated on callback at `pkce-core.ts:150` (`state !== expectedState`) — strict `!==`. ✓
2. **code_verifier length**: `base64url(randomBytes(32))` -> 43 chars; `validatePkceMaterial` enforces 43–128. ✓
3. **code_challenge**: `base64url(sha256(verifier))`; `code_challenge_method=S256` in authorize URL. ✓
4. **Redirect URI exact-match**: `pkce-core.ts:131` uses `callbackUrl !== redirectUri` (exact `===`, not startsWith/regex). ✓
5. **Token storage**: `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR/credentials.json`); `writeFile` with `mode: 0o600, flag: 'wx'` to a tmp path then `rename` then `chmod 0o600`; rollback on failure. Atomic + correct perms. ✓
6. **No token in logs/events**: New events (`init.auth_started/detected_existing/pkce_url_emitted/completed/failed`) carry only `provider`, `source` (env var name or path), `url` (auth URL — no token), `reason` (error code). `authError.context.reason` is the error code only. Token never reaches stdout/stderr/event stream. ✓
7. **Callback server**: Bound to `127.0.0.1` (rejects any other host with `auth_pkce_callback_host_invalid`); `DEFAULT_TIMEOUT_MS = 5 * 60_000`; single-shot — both success and error paths call `closeSoon(server)`. ✓
8. **Browser URL**: `buildAuthorizeUrl` includes only public params (client_id, code_challenge, state, scope, redirect_uri). No secrets. ✓
9. **Callback success page**: `"Anthropic authentication completed. You can close this window."` — no token echo. HTML-escaped. ✓
10. **Verifier reuse**: Each `loginAnthropicWithPkce` invocation calls `generatePKCE()` fresh; no caching across attempts. The new auth-anthropic step calls `loginAnthropicWithPkce` once per init; retries go through `--resume`, which re-enters the step (fresh PKCE). ✓

## Behavior review (D135 + P1 contract)

- Output-mode toggle honored: `shouldAuthenticate` short-circuits prompts in non-human mode; `humanNote`/spinner gated on `outputMode === 'human'`.
- New init events registered in `D135_INIT_STREAM_EVENT_KINDS`; envelope written via `writeInitEvent`. ✓
- Structured errors: `InitCommandError` with `code`, `recoverable: true`, `suggestedActions` (resume_init / standalone_login). ✓
- New flags wired in `init.ts`, `help.ts`, `options.ts` (`--login`, `--no-login`, `--no-browser`, `--resume`); `DUCTUM_NO_BROWSER=1` honored.
- `--resume` resolves paths/validation without re-prompting (`resumeInitTarget`); structured path also relaxes required-arg check on `--resume`.
- Existing-auth detection covers all four env vars + on-disk credentials.
- Scaffolder writes claude-builder agent + claude-agent-sdk harness (pinned `0.2.119`) when authenticated; `assertFactoryYamlValid` re-parses YAML to validate shape before write.

## Behavior nits (non-blocking)

- `runStructuredInit` does not wrap `authenticateAnthropic` in `rejectOnAbort` like the human path does (`structured.ts`). The PKCE core honors `signal` directly, so SIGINT during the network/callback phase still surfaces an abort, but a minor inconsistency vs. the human flow.
- `shouldOpenBrowser` returns false in structured mode regardless of `--no-browser`. That matches "structured = no browser open" but means `--no-browser` is a no-op there; worth documenting.
- `defaultOpenBrowser` on Windows shells through `cmd /c start "" <url>` — `&` in URL params can confuse cmd's parser. Pre-existing (this commit just relocated the function), not introduced by P1, but worth tracking as a separate item.

PASS
