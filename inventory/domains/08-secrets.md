# Secrets

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The secret surface is a well-built, well-tested local-first encrypted store: AES-256-GCM crypto with a 0600 key-file guard, a write-only dashboard panel, public-output redaction, and literal-secret detection on Factory Settings inputs. The cryptography, storage, refs, and redaction layers are solid and fit the current Factory model. The critical gap is that this entire encrypted system is wired only to notification channels (telegram) and the manual /test endpoint — it is NOT consumed by agent dispatch. Dispatched Claude agents instead inherit the full host process.env (claude.ts:186-188), so the FactorySecretResolver and per-agent secretAccessRefs are computed and displayed but never injected, making the encrypted store security theater for the actual agent execution path.

## Factory secret crypto (AES-256-GCM + key file)
- **What:** Symmetric envelope encryption for stored secrets: AES-256-GCM with a per-secret 12-byte nonce, auth tag, and a 32-byte local key file (`.ductum/secrets.key`) that is permission- and symlink-checked before use.
- **Where:** `packages/core/src/factory-secret-crypto.ts:14-84` (`loadFactorySecretKey`, `encryptFactorySecret`, `decryptFactorySecret`); key-id binding at `:57-59`, 0600 enforcement at `:22-24`, symlink reject at `:18`.
- **Maturity:** live-core
- **Quality:** solid — sound AEAD construction, random nonce per encrypt, auth-tag verified on decrypt, keyId binding prevents cross-key decrypt; tested in `tests/factory-secret-crypto.test.ts`.
- **Operator-legibility risk:** none — no raw-state interpretation needed.
- **Dependencies:** node:crypto; relies on `factory-settings-store-types` payload types; consumed by resolver and the route.
- **Disposition (recommended):** KEEP — correct, minimal, well-guarded crypto that fits the local-first model.
- **Flags:** none. (Minor: no key rotation/re-encryption path — rotating the key file orphans all existing payloads via the keyId mismatch at `:57-59`, but that is a feature gap, not a bug.)

## Factory secret resolver
- **What:** Resolves a `secret:<id>` reference to plaintext by loading the stored record, loading the key file, and decrypting.
- **Where:** `packages/core/src/factory-secret-resolver.ts:10-21`. Consumers: `packages/api/src/lib/telegram-runtime.ts:175-178` (notifications) and `packages/api/src/routes/factory-secrets.ts:80-83` (manual test) only.
- **Maturity:** live-peripheral
- **Quality:** adequate — the class itself is correct and minimal, but its reach is tiny: only notification token resolution and the /test endpoint call it. It is absent from the dispatch/harness path entirely.
- **Operator-legibility risk:** partial — an operator who configures `secret:<id>` for an agent will reasonably assume it is injected at dispatch; it is not, and nothing surfaces that.
- **Dependencies:** `factory-secret-crypto`, `factory-secret-refs`, `FactorySecretRepo.get`.
- **Disposition (recommended):** REUSE — the resolver is the right primitive; it needs to sit behind a dispatch-time env-injection boundary that does not yet exist.
- **Flags:** security/legacy-gap — encrypted secrets are wired ONLY to notifications, never to agent dispatch (confirmed: no resolver call anywhere under `packages/harness/src`).

## Secret ref grammar (`secret:<id>`)
- **What:** Parse/format/validate helpers for the `secret:<id>` reference token, rejecting whitespace/quote/backslash injection in the target.
- **Where:** `packages/core/src/factory-secret-refs.ts:1-21`.
- **Maturity:** live-core
- **Quality:** solid — tight regex guard at `:19-21`; used uniformly by detection, redaction, resolver, and ref collection.
- **Operator-legibility risk:** none.
- **Dependencies:** none; depended on broadly.
- **Disposition (recommended):** KEEP — small, correct, central grammar.
- **Flags:** none.

## Literal-secret detection on Factory Settings input
- **What:** Validation pass that rejects literal secrets in Factory Settings / Project resources, requiring `${ENV_VAR}` or `secret:<id>` instead; includes a command-line `VAR=value` scanner.
- **Where:** `packages/core/src/secret-detection.ts:41-129`; sensitive-assignment regex `:7`; container-key allowlist `:6`.
- **Maturity:** live-core
- **Quality:** adequate — solid structural scan with good test coverage (`tests/secret-detection.test.ts`, `api/.../settings-secret-validation.test.ts`), but regex-based detection of arbitrary sensitive env names is inherently best-effort and can miss non-conventional names.
- **Operator-legibility risk:** partial — error message is clear, but a value that slips the heuristic is silently accepted as a literal.
- **Dependencies:** `factory-secret-refs`, `public-redaction` (`isSafeEnvReference`, `isSensitivePublicKey`).
- **Disposition (recommended):** KEEP — good defensive input gate; treat as best-effort, not a guarantee.
- **Flags:** none (heuristic coverage limit is inherent, not a defect).

## Public-output redaction
- **What:** Redacts secret-looking values, sensitive keys, bearer tokens, URL passwords/query params, and YAML/`VAR=` assignments from all public API output, while preserving safe `${ENV}`/`secret:<id>` refs.
- **Where:** `packages/core/src/public-redaction.ts:53-243`; secret-value patterns `:33-40`; spawn-config redaction `:57-68`.
- **Maturity:** live-core
- **Quality:** solid — broad layered redaction with explicit safe-key/safe-status allowlists; tested in `tests/public-redaction.test.ts` and `dashboard/.../settings-redaction.test.tsx`.
- **Operator-legibility risk:** none.
- **Dependencies:** `factory-secret-refs`; consumed by `api/lib/public-output` and the routes.
- **Disposition (recommended):** KEEP — central to keeping plaintext out of API responses.
- **Flags:** none.

## Secret storage repo + DB schema
- **What:** SQLite repo splitting metadata (`factory_secret_metadata`) from ciphertext (`factory_secret_payloads`), with factory/project scope, name uniqueness indexes, and CASCADE delete.
- **Where:** `packages/core/src/repos/secret.ts:35-185`; schema `packages/core/src/db-migrations.ts:838-873`.
- **Maturity:** live-core
- **Quality:** solid — parameterized queries, transactional create/update, metadata/payload separation so reads never carry ciphertext unless explicitly via `get`.
- **Operator-legibility risk:** none.
- **Dependencies:** SqliteDatabase; `FactorySecretRepo` interface.
- **Disposition (recommended):** KEEP — clean separation of metadata vs ciphertext is exactly right.
- **Flags:** none.

## Factory secrets HTTP routes
- **What:** CRUD + `/test` endpoints for secrets; create/rotate encrypt on the server and return metadata only (never plaintext); `/test` resolves to confirm decryptability.
- **Where:** `packages/api/src/routes/factory-secrets.ts:18-130`; scope validation `:99-112`; ref existence check via `api/src/lib/secret-refs.ts:7-13`.
- **Maturity:** live-core
- **Quality:** solid — write-only contract (no plaintext read path), scope/project validation, `publicOutput` wrapping; tested in `api/.../factory-secrets-p5.test.ts`.
- **Operator-legibility risk:** none.
- **Dependencies:** `@ductum/core` crypto + resolver + repo; `requireFactoryDir`.
- **Disposition (recommended):** KEEP — correct write-only REST surface.
- **Flags:** none.

## Dashboard SecretsPanel
- **What:** React panel to create/rotate/test/delete secrets; plaintext held only in transient input state, cleared at submit, deliberately bypassing react-query cache so plaintext never persists client-side.
- **Where:** `packages/dashboard/src/settings/SecretsPanel.tsx:16-214`; cache-bypass rationale `:10-15,44-69`.
- **Maturity:** live-core
- **Quality:** solid — `type=password`, `autoComplete=new-password`, submit-time clear, metadata-only reads; tested in `dashboard/.../settings-secrets.test.tsx`.
- **Operator-legibility risk:** none — status (configured/test_failed/missing), rotated/tested timestamps shown plainly.
- **Dependencies:** `api/client`, `useFactorySecrets` hook.
- **Disposition (recommended):** KEEP — careful write-only UI.
- **Flags:** none.

## Per-agent secretAccessRefs (declared, never injected)
- **What:** Each Agent's `spawnConfig` is scanned for `secret:<id>` refs into a read-only `secretAccessRefs` list shown in the Agent settings panel.
- **Where:** computed `packages/core/src/factory-settings.ts:220` via `collectSecretRefs` (`factory-settings-catalog-helpers.ts:40-50`); type `factory-settings-types.ts:114`; displayed `dashboard/.../AgentSettingsPanel.tsx:111`.
- **Maturity:** experimental
- **Quality:** fragile — the refs are collected and displayed but no code path resolves them into the dispatched agent's environment; meanwhile `claude.ts:186-188` injects `...process.env` wholesale, so declared secret access is both unenforced and bypassed.
- **Operator-legibility risk:** high — the UI states an agent's "secret access refs," implying scoped secret provisioning that does not actually happen; the operator must know dispatch ignores it.
- **Dependencies:** `collectSecretRefs`, `parseFactorySecretRef`; would need a dispatch-time resolver hook that does not exist.
- **Disposition (recommended):** REDESIGN — the capability (scoped per-agent secret injection) is needed but the current shape is a display-only stub disconnected from dispatch.
- **Flags:** security — full host `process.env` (including ANTHROPIC_API_KEY and every host credential) is inherited by every dispatched agent (`packages/harness/src/claude.ts:186-188`); the encrypted FactorySecret system is never consulted at dispatch.

## Legacy / dead-but-not-deleted in this domain
- None found. The secret modules are all live and referenced. Note: `legacy-migration-secrets.d.ts` appears in `packages/core/dist/` but the corresponding `src/legacy-migration-secrets.ts` is absent (stale compiled artifact in dist only) — not a source-tree legacy item, just a build-output remnant; cleaning `dist/` would remove it. The substantive issue is not dead code but a wiring GAP: the encrypted-secret path stops at notifications and `/test`, and never reaches agent dispatch, which instead leaks the entire host `process.env`.
