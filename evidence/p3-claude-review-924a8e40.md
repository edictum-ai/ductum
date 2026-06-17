# FINDINGS

1. **Item #2 (separate tokens) — PASS (CLI side).** `mintOperatorToken()` (32 random bytes, base64url) is written to `.ductum/operator-token` and `.env.local` (0o600 + `wx`). The handoff token comes back as a distinct field from `POST /api/welcome/handoff`. Test asserts the printed URL contains `handoff_secret`, never the operator token, and the operator token never appears in stdout/envelopes (`browser-handoff.test.ts:84-86`).

2. **Item #8 (query param, not fragment) — PASS.** `handoffUrl = \`${apiUrl}${handoff.welcomePath}?token=${encodeURIComponent(handoff.token)}\`` (browser-handoff.ts:96). Tradeoff is implicit, not documented in a decision file in this diff.

3. **Item #9 (API protected from start) — PASS.** `waitForProtectedApi` requires `operatorTokenProtected === true` from `/api/health` and throws `init_api_unprotected` otherwise (api-process.ts:75-90). API is spawned with `DUCTUM_OPERATOR_TOKEN` in env; loopback-only via `--host 127.0.0.1`. Env is sanitized — only PATH/HOME/TERM/NODE_ENV pass through, so `ANTHROPIC_AUTH_TOKEN` etc. don't leak into the child (test verifies).

4. **Items #1, #3, #4, #5, #6, #7, #10 — NOT VERIFIABLE FROM THIS DIFF.** This diff is CLI-only. The handoff TTL/one-shot/binding semantics, `/welcome` route's `history.replaceState()`, cookie flags (httpOnly/secure/sameSite=strict/path), DOM/localStorage scrubbing, exchange-endpoint validation, and external-resource referer-leak prevention all live in the API + dashboard code (`/api/welcome/handoff`, `welcome.tsx`) which is not in the patch. The CLI test mocks the endpoint with `ttlSeconds: 60` and expectation, but this is unverified against actual server code.

5. **Error message redaction — PASS.** `apiRequest` throws `\`API ${method} ${path} failed with ${response.status}\`` without including response body. Test `createFailingSeedFetch` returns `{error: 'operator_secret'}` body and confirms `error.context.cause` does not contain it (browser-handoff.test.ts:163-181).

6. **Browser argv leak — minor.** `defaultOpenBrowser` passes the handoff URL as a positional argv to `open`/`xdg-open`/`cmd start`, briefly visible to other local processes via `ps`. Acceptable on a single-user dev box; bounded by the (claimed) 60s one-shot TTL. Worth a comment.

7. **Terminal scrollback exposure — acceptable.** In `--no-browser` and `DUCTUM_NO_BROWSER=1` paths, the full handoff URL (with token) is printed to stdout via `p.note` and is included in the human `outro` next-steps. This is intentional for manual handoff and bounded by the (server-side, unverified here) one-shot 60s TTL. Structured/NDJSON mode correctly omits the handoff token from envelopes (test asserts `init.completed.nextSteps` carries the clean dashboard URL only).

8. **Contract drift — WARN.** Contract specifies event kinds `init.serve_starting/serve_ready/serve_timeout` and error codes `serve_start_failed/serve_health_timeout/serve_port_in_use`. Diff ships `init.api_starting/api_ready` and `init_api_start_timeout/init_api_unprotected/init_api_dist_missing/init_api_seed_failed/init_handoff_failed`. Names diverge; consumers reading from §3.4 will mismatch. Also the `ductum start` CLI command from §3.2 is not in this diff.

9. **File-size budget — WARN.** `start-and-handoff.ts` (named `browser-handoff.ts` here) is ~193 LOC; contract caps at 180. Above budget but under the 300 LOC repo gate.

10. **Re-run idempotency — minor.** `writeFactoryOperatorToken` uses `flag: 'wx'`; a second `ductum init` against an existing factory will throw on the operator-token write. Likely intentional (one-shot init) but not documented; `--resume` interaction is unclear.

11. **Port TOCTOU — minor.** `findFreeLoopbackPort` allocates an ephemeral port, closes the socket, then spawns the API on it. Another process could claim the port between close and spawn. Low risk on a dev box; if hit, `waitForProtectedApi` will time out cleanly.

# VERDICT
WARN

Security gates verifiable from this CLI-only diff (#2, #8, #9, env sanitization, error redaction) all pass. Gates #1, #3, #4, #5, #6, #7, #10 require the matching API + dashboard diff (`/api/welcome/handoff` endpoint and `welcome.tsx`) — they cannot be cleared on this diff alone. Contract drift (event/error naming, file-size budget, missing `ductum start` command) is non-security but worth reconciling before merge.

# SUGGESTED CMDS
N/A — this is WARN, not FAIL. Before clearing P3 end-to-end, review the API/dashboard counterpart diff against gates #1, #3-7, #10, and either rename events/codes to match §3.4 or amend the contract via a decision file.
