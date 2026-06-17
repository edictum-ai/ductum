# P1 Opus Review — PKCE Core Extraction

Command:

```sh
claude -p --model claude-opus-4-7 "<strict P1 security checklist + staged diff>"
```

Reviewer: Claude Opus 4.7

## Security Review

1. PKCE state — PASS. State is generated independently with `base64url(randomBytes(32))` and validated on callback. The prior verifier-as-state bug is fixed; tests assert the auth URL does not contain the verifier.
2. Verifier length and RNG — PASS. `randomBytes(32)` yields a 43-char base64url verifier, and validation enforces 43-128 chars.
3. Challenge derivation — PASS. `code_challenge` is `base64url(sha256(code_verifier))`.
4. Redirect URI exact match — PASS. Callback URL must equal the generated `http://127.0.0.1:<port>/callback`; `localhost` is rejected.
5. Token storage — PASS. Path is `~/.claude/.credentials.json` or `$CLAUDE_CONFIG_DIR/credentials.json`; writes use temp file, `wx`, `0600`, rename, and final chmod.
6. Token leakage — PASS. Token-exchange errors do not include response bodies. Callback HTML is static and does not echo tokens.
7. Callback server — PASS. Bind host is restricted to `127.0.0.1`; default timeout is five minutes; callback closes after success or error.
8. Browser URL — PASS. Auth URL contains PKCE auth parameters only, not the verifier or any token.
9. Success page — PASS. No token echo.
10. Verifier reuse — PASS. PKCE material is generated per login attempt.

## Behavior Notes

- Parent directory mode is inherited from the user's umask. File mode is still `0600`, so token confidentiality holds.
- State comparison is ordinary string comparison. Reviewer considered this acceptable for single-use localhost OAuth state.
- Temp filename uses pid and timestamp, with `wx` preventing clobber.
- `AuthPkceError` codes line up with the P1/D135 structured-error surface.

## VERDICT

PASS
