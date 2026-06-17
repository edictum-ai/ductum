# FINDINGS

1. **Diff is API-only.** No `welcome.tsx` (criteria 3, 5, 10) and no CLI `start-and-handoff.ts` (criterion 8). Those four checks are unverifiable from this patch and need a separate review when the dashboard/CLI commits land. Flagging here so they don't slip past.

2. **Exchange endpoint must be exempt from `operator-auth`.** `/api/internal/welcome/exchange` is the *only* call the browser can make before it has the cookie, so it cannot require `operator-auth`. The diff doesn't show any allowlist change to `middleware/operator-auth.ts`, and the test "exchanges once…" does not send a bearer/header token yet expects 200 — so exemption must already exist (e.g. `/api/internal/*` skipped, or operator-auth only mounted on a subset of routes). **Verify this exemption is real before merging**; if the middleware is global to `/api/*`, this route is broken in production but accidentally passing the test, and an unauth check is missing for the test config.

3. **Cookie value is the literal operator token (URL-encoded), not a session id.** `serializeOperatorCookie(consumed.operatorToken)` writes the operator token verbatim into the cookie. HttpOnly+Secure+SameSite=Strict+Path=/api mitigates JS/CSRF exposure, so criterion 7 is met, but a separate session id with server-side mapping would be a cleaner blast-radius reduction. Acceptable for now given the constraints, but worth a follow-up decision.

4. **`Path=/api` scoping is correct** — dashboard HTML loads at `/welcome` won't transmit the cookie, only API XHRs will. Good.

5. **`Secure` flag on plain-HTTP localhost.** Chrome/Firefox honor `Secure` over HTTP for localhost; Safari has historically been stricter. Demo path on Safari may silently fail to set the cookie. Worth a one-line note in the P3 evidence/decision and a fallback test on Safari.

6. **Mint endpoint anonymous-access coverage gap.** No test exercises `/api/welcome/handoff` *without* `x-ductum-operator-token` to confirm operator-auth middleware actually rejects it. The handler only checks that operatorToken is *configured*, not that the caller authenticated — relies entirely on global middleware. Add a "missing token → 401" test to lock this in.

7. **TTL guarded both ways.** `mint()` uses `Math.min(this.ttlMs, WELCOME_HANDOFF_TTL_MS)` so even a misconfigured store can't issue >60s tokens. ✅ Defensive and matches criterion 1.

8. **One-shot consume + factory binding + expiry pruning all correct** (criterion 1, 6). Replay test (returns 410, no Set-Cookie) and factory-mismatch test (returns 401) are good. ✅

9. **No operator-token leakage in mint/exchange response bodies** (criteria 2, 5-API-side). Tests assert `not.toContain('operator-secret')` on both. ✅

10. **In-memory store** is fine for the single-process serve P3 ships; if `ductum start` ever spawns a worker pool, this becomes silently broken (token minted in process A, exchange hits process B → `missing`). Worth a one-line comment on `HandoffTokenStore` documenting the single-process assumption.

11. **Minor: `recoverable: true` on `operator_token_missing` / `factory_missing` errors.** Mid-handoff these aren't recoverable by retry — they need a different config/init step. Cosmetic for D135 conformance, not security.

# VERDICT
WARN

API surface for the handoff exchange is solid: 60s TTL, one-shot, factory-bound, no operator-token leakage in response bodies, httpOnly/Secure/SameSite=Strict/Path=/api cookie. **Two items to confirm before this is fully signed off:** (a) `/api/internal/welcome/exchange` is genuinely exempt from `operator-auth` (finding 2), and (b) the missing `welcome.tsx` + CLI handoff pieces re-clear criteria 3, 5, 8, 10 when they land. Add finding 6's missing-auth mint test and finding 10's single-process comment as small follow-ups.
