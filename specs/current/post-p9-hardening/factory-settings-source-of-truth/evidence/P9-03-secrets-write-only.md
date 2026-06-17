# P9 Evidence 03 — Secret Write-Only Proof

Method: two freshly generated high-entropy sentinel strings were submitted as
the secret value (one at create, one at rotate) and then swept for across
every output surface. The sentinel plaintext is **intentionally not
reproduced in this file** — evidence is itself a public output surface, and
recording submitted secret values here would violate the same write-only rule
this proof exists to check. Below they are referred to as sentinel A
(created) and sentinel B (rotated). To re-verify, repeat the procedure with
fresh sentinels; the sweep commands are recorded verbatim.

## Lifecycle exercised (typed API, operator token header)

| Step | Call | Result |
|---|---|---|
| create | `POST /api/factory/secrets` `{name:"demo-provider-key", value:<sentinel A>, description}` | 201; response is metadata only (id, name, scope, status `configured`, timestamps). No value echoed. |
| list | `GET /api/factory/secrets` | metadata array only |
| detail | `GET /api/factory/secrets/:id` | metadata only |
| test | `POST /api/factory/secrets/:id/test` | resolves the ciphertext internally via `FactorySecretResolver`; response stamps `lastTestedAt`, still metadata only |
| rotate | `PATCH /api/factory/secrets/:id` `{value:<sentinel B>}` | `lastRotatedAt` bumped; metadata only |
| delete | `DELETE /api/factory/secrets/:id` | 204; list returns `[]` |

## Leak sweep (all clean — 0 sentinel hits)

| Surface | Check | Hits |
|---|---|---|
| raw DB bytes | `grep -ac <sentinel> ductum.db ductum.db-wal ductum.db-shm` | 0 / 0 / 0 |
| encrypted-at-rest | `grep -ac "aes-256-gcm" ductum.db-wal` | 2 rows (create + rotate payloads) — ciphertext stored, not plaintext |
| API process logs | start logs + `.ductum/logs/api.log` | 0 |
| events | `GET /api/events?limit=200` | 0 |
| CLI output | `ductum factory settings` (human and `--json`) | 0 |
| evidence | this file and the rest of `evidence/**` contain no sentinel plaintext (see correction note) | 0 |

UI path: the dashboard Settings Secrets panel submits plaintext once and
clears the input synchronously at submit time (pending and failure paths
included), pinned by `packages/dashboard/src/tests/settings-secrets.test.tsx`
(P6 review fix). No read API exists for the UI to display a saved value.

PASS: plaintext cannot be read back from API, UI, CLI, logs, events, DB bytes,
or evidence after save. Key file `.ductum/secrets.key` (32 bytes, 0600) stays
out of git per P9-01.

## Correction note (review round 1)

The first committed version of this file (in `d3ec13f`) recorded both
sentinel plaintext values verbatim — in the method line and in the create and
rotate request bodies — and claimed that was acceptable "as test labels". The
arc review correctly ruled that a hard fail: evidence is a public output
surface, and submitted secret values must never persist there, synthetic or
not. This revision redacts the values; the procedure is unchanged and
re-runnable. The superseded text remains visible in git history as the honest
record of the failure — acceptable only because the values were random
single-use test strings, the secret record was deleted during the proof, and
the demo factory is throwaway. Had a real credential been written here, the
required response would have been rotation of the credential, not just a
redacting edit. Process rule going forward: evidence may describe a submitted
secret (entropy, length, generation method) but never quote it.
