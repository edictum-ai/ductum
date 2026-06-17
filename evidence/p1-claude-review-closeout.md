# P1 Claude Review — Closeout Docs/Evidence

Command:

```sh
claude -p --model claude-opus-4-7 "<strict P1 closeout staged-diff review prompt>"
```

Review prompt included the P1 mandatory FAIL checklist and added closeout checks:

- Closeout banners should say P1 shipped; P2 next.
- Evidence must not include access or refresh token values.

## Review Output

# P1 PKCE Closeout Review

Staged diff scope: status banners (`AGENTS.md`, `CLAUDE.md`, `specs/CURRENT.md`), `decisions/152-bootstrap-p1-yaml-validation-drift.md`, `evidence/p1-pkce-login-demo.txt`. No code changed; verified against referenced `packages/cli/src/login/pkce-core.ts`.

## Security checklist (1–10)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | State crypto-secure + validated | PASS | `randomBytes(32)` line 91; `state !== expectedState` reject line 150 |
| 2 | verifier 43–128 chars via randomBytes | PASS | `randomBytes(32)` -> base64url = 43 chars; validator lines 228–232 |
| 3 | challenge = base64url(sha256(verifier)) | PASS | line 90, no shortcuts |
| 4 | Redirect URI exact-match | PASS | strict `!==` line 131 |
| 5 | `~/.claude/.credentials.json` 0600 | PASS | evidence: `credentialsPath: $HOME/.claude/.credentials.json`, `credentialsMode: 0600` post-init |
| 6 | No token leak in logs/errors/evidence | PASS | evidence uses booleans (`accessTokenNonEmpty: true`); errors use generic codes; stdout/stderr leak checks `false` |
| 7 | Callback 127.0.0.1, 5 min, single-shot | PASS | `CALLBACK_HOST='127.0.0.1'` + host guard line 115; `DEFAULT_TIMEOUT_MS = 5 * 60_000`; `closeSoon` after every branch |
| 8 | Browser URL has no secrets | PASS | `buildAuthorizeUrl` carries `code_challenge` only; evidence: `authUrlContainsVerifier: false` |
| 9 | Success page does not echo token | PASS | static "authentication completed" string line 158 |
| 10 | verifier not reused | PASS | `generatePKCE()` called fresh per `loginAnthropicWithPkce` invocation line 51 |

## Behavior notes (WARN-level)

- D152 documents an intentional deviation from P1's "validate via `@ductum/core` factory loader" — narrow CLI-side static check until a core loader exists. Documented honestly with rollback semantics preserved (`init_yaml_invalid` -> rollback). Acceptable, but worth flagging as a contract deviation that P2/P5 will eventually need to retire.
- D135 envelope honored: evidence shows `init.*` event kinds and `cli.outputMode: auto` in scaffold. ✓
- Closeout banners ("P1 shipped; P2 next") consistent across `AGENTS.md`, `CLAUDE.md`, `specs/CURRENT.md`. ✓
- Evidence honestly records "flow was not completed against a real Anthropic tenant in this session" rather than overclaiming. ✓

## Minor flags (non-blocking)

- `requestUrl.origin` is built from `req.headers.host`; mismatch with `redirectUri` results in 404 (not a bypass), but a Host-header check would be more defensible. Listening on 127.0.0.1 already neuters DNS rebinding — leave as-is unless P2 hardens.
- `closeSoon` uses `setImmediate(server.close)` — connections in-flight could in theory race a second request. Single-shot semantics hold because state is consumed and `resolveCode` only fires once; not a finding.

VERDICT:
PASS
