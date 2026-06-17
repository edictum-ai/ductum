# FINDINGS

1. **PASS — TTL, one-shot, factory binding (req 1, 6).** `HandoffTokenStore` uses 60s TTL (`WELCOME_HANDOFF_TTL_MS = 60_000`, `handoff-tokens.ts:3`), one-shot via `consumedAtMs` set on consume (`handoff-tokens.ts:51`), bound to factoryId at mint and verified at exchange (`handoff-tokens.ts:35,50`). Tests cover all four reject paths (missing/consumed/expired/factory_mismatch) including the "minted for a different factory" case (`welcome-handoff.routes.test.ts:105`).

2. **PASS — handoff ≠ operator token (req 2).** Handoff is 32 random bytes (`handoff-tokens.ts:30`); test verifies it is rejected when used as `ductum_operator_token` against `/api/factory` (`welcome-handoff.routes.test.ts:47-51`).

3. **PASS — URL stripped via `replaceState` (req 3).** `Welcome.tsx:30` calls `stripHandoffQuery()` which calls `window.history.replaceState(...)`, executed in the first `useEffect` before any navigation can happen. Test asserts `window.location.search === ''` and `replaceSpy` target is `/welcome`.

4. **PASS — cookie hardening (req 4, 7).** `serializeOperatorCookie` sets `Path=/api; HttpOnly; Secure; SameSite=Strict` (`welcome-handoff.ts:78-86`). HttpOnly blocks `document.cookie` exposure; Path=/api scopes it; route test asserts each attribute (`welcome-handoff.routes.test.ts:67-71`).

5. **PASS — operator token never echoed (req 5).** Mint and exchange responses contain only handoff token / factoryId / timestamps. Tests assert the raw `operator-secret` literal does not appear in either response body (`welcome-handoff.routes.test.ts:24,45,65`). Dashboard tests assert no `operator` substring in `document.cookie` and nothing in `localStorage.ductum.operatorToken`.

6. **PASS — exchange validation (req 6).** `consume()` checks existence, consumed flag, expiry, and factoryId (`handoff-tokens.ts:43-52`). Replay test confirms second call returns 410 with no Set-Cookie (`welcome-handoff.routes.test.ts:78-83`).

7. **PASS — handoff in query, not fragment (req 8).** Diff uses `searchParams.get('token')` and the URL is constructed by the (out-of-diff) CLI as a query param consistent with D149.

8. **PASS — mint endpoint requires operator-token from start (req 9).** `/api/welcome/handoff` is not in `isPublicOrSessionScoped`, so the operator-auth middleware enforces it. Test `requires operator-token auth before minting` asserts 401 without the header (`welcome-handoff.routes.test.ts:17-25`).

9. **PASS — no external resources on /welcome (req 10).** `Welcome.tsx` imports only local components; no `<img>`, `<script>`, fonts, or fetches to non-`/api` origins. Dashboard test asserts `document.querySelectorAll('[src^="http"],[href^="http"]').length === 0`.

10. **WARN — HTTPS-on-localhost tradeoff not explicitly documented.** D149 mentions the URL handoff and rotation-to-cookie pattern but does not explicitly state "HTTPS is unavailable on localhost, so the handoff token must travel as a URL query param" as the operator-direct constraints required. Recommend a one-paragraph addition to D149 (or a follow-up D154) before P3 closes.

11. **WARN (pre-existing, outside diff) — `/api/internal/operator-token-detect` returns the plaintext operator token to any unauthenticated loopback caller** (`packages/api/src/app.ts:47-57`). This endpoint completely bypasses the entire handoff-token threat model: any local process, browser tab, or extension on the machine can `GET` it and receive the operator token in JSON. The P3 handoff design protects against URL/Referer/history leaks of the operator token, but this endpoint is a separate, unauthenticated exfiltration channel that defeats most of that protection. Strongly recommend gating this endpoint behind a per-process one-shot bootstrap secret (e.g., a CLI-issued bearer in a file under `~/.ductum/` with `0600` perms) before P4 publishes the binary.

12. **MINOR — `Secure` cookie on http://localhost.** Modern Chrome/Firefox/Safari treat `localhost` as a secure context, so the `Secure` attribute does not block the cookie. Worth a one-line comment near `serializeOperatorCookie` so future readers don't strip `Secure` thinking it breaks localhost.

13. **MINOR — pre-exchange query bursts will 401 once.** `Welcome.tsx` mounts `useFactory/useProjects/useAgents/useSpecs` immediately; with no localStorage token and the cookie not yet set, the first batch will 401 before the exchange completes and triggers `invalidateQueries`. Functionally fine, just produces a noisy network panel. Could `enabled: handoffState !== 'exchanging'` the queries when a `?token=` is present.

# VERDICT
PASS (with WARN — see findings 10 and 11; finding 11 is the most consequential and is pre-existing, but it materially undermines the threat model this whole arc is built to address).

# SUGGESTED CMDS
- Add tradeoff paragraph to `decisions/149-bootstrap-browser-handoff.md` covering "no HTTPS on localhost → query param is the only practical handoff channel".
- Open a follow-up decision + ticket to gate `/api/internal/operator-token-detect` behind a bootstrap secret before global install in P4.
