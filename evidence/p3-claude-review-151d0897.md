# FINDINGS

1. **Mint endpoint auth coverage (Check 9) — added.** New test at `welcome-handoff.routes.test.ts:17-25` proves `POST /api/welcome/handoff` returns 401 without the operator token. Confirms the route is *not* in `isPublicOrSessionScoped` (only `/api/health`, `/api/internal/*`, `/api/telegram/webhook` are exempt — `operator-auth.ts:24`), so the mint surface is protected from the very first serve boot. ✓
2. **In-memory store comment (`handoff-tokens.ts:17-18`).** Honest scoping note that the `Map`-backed store assumes one API process per local factory. Matches P3 reality (single local serve); a clustered deployment would need shared storage. Acceptable; documenting the constraint is correct rather than over-engineering it. ✓
3. **Handoff ≠ operator token (Check 2).** Already covered by the sibling test at line 47-51 (handoff token used as `?ductum_operator_token=` returns 401). Not regressed.
4. **Auth-failure body leak check.** New assertion `expect(response.text).not.toContain('operator-secret')` is trivially satisfied (body is just `{"error":"Operator token required"}`) — fine, defensive belt-and-suspenders.
5. **Out-of-scope WARNs (not in this diff, flagging per "always flag bugs"):**
   - `operator-auth.ts:32-33` accepts `?ductum_operator_token=` query param for *any* API call — that's a referer/log-leak vector for the real operator token (separate from the handoff token URL handoff which P3 explicitly accepts as a one-shot). Worth a follow-up to restrict query-string auth to a narrow path, or remove it.
   - The exchange cookie value *is* the operator token verbatim (`ductum_operator_token=operator-secret`, route line 80). A session ID indirected through a server-side table would be stronger; today the cookie is functionally equivalent to handing the raw operator token back to the browser (HttpOnly mitigates JS read, but anything with cookie access = full operator privileges). Pre-existing in af8dbab, not introduced here.
   - `Secure` cookie on `http://localhost` works in Chrome/Firefox (localhost is a secure context) but won't survive if someone serves over `http://127.0.0.1` or LAN IP. Acceptable for P3 local-only scope; document if P4 broadens host binding.
6. **Frontend security checks (3, 4-frontend, 5-frontend, 7, 10) not in this diff.** No `welcome.tsx` exists yet — those checks must be re-run when the dashboard route lands.

# VERDICT
PASS
