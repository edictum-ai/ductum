# FINDINGS

## Strict supply-chain checks (1-12)

| # | Item | Result |
|---|------|--------|
| 1 | `files` array explicit & minimal | PASS — `["dist","assets","README.md","LICENSE"]`; gate rejects `*`/`.`/`**` |
| 2 | No `^`/`~` in deps | PASS — all 13 deps in `packages/ductum/package.json` exact-pinned; gate enforces |
| 3 | Lockfile + `--frozen-lockfile` | PASS — `pre-publish-gate.mjs:42` uses `pnpm install --frozen-lockfile` |
| 4 | No install scripts in published manifest | PASS — `scripts={}` in evidence; npm registry confirms no `scripts` field |
| 5 | No hardcoded secrets in shipped sources | PASS — gate scans tarball with `SECRET_CONTENT_PATTERN` for `sk-ant-`/`npm_`/`gh[op]_`/known env names |
| 6 | No `.env`/`.npmrc`/credentials in tarball | PASS — `blockedPathMatches=[]` in evidence; gate enforces |
| 7 | Cross-platform `bin` shim | PASS — `dist/bin/ductum.js` with `#!/usr/bin/env node`, ESM, `type: module`; npm/pnpm generate `.cmd` shims on Windows |
| 8 | No source/source-maps in tarball | PASS — `tsOrSourceMapMatches=[]`; only compiled `dist/` ships |
| 9 | Provenance flag enforced or drift accepted | PASS (with explicit drift) — `publishConfig.provenance=true`, gate runs `npm publish --dry-run --provenance`, real publish lacked provenance; D157 records explicit risk acceptance with follow-up. Verified via `npm view ductum@0.1.0 --json`: `signatures` (registry signing) present, **no `attestations` field** — confirms no provenance attestation, matching D157 |
| 10 | Token-detect old probe gated/removed | OUT-OF-DIFF — D156 / pre-P4 surface; not touched here |
| 11 | `ductum serve` 127.0.0.1 only | OUT-OF-DIFF — not modified by this marker diff |
| 12 | `ductum start` token overwrite | OUT-OF-DIFF — not modified by this marker diff |

## Live-registry verification

Confirmed against `https://registry.npmjs.org/`:
- `name=ductum`, `version=0.1.0` (created `2026-05-04T19:39:32Z`)
- `dist.integrity` matches the evidence file's claim verbatim
- `gitHead=a1dff56a` matches local commit "docs(bootstrap): mark p4 ready to publish"
- `fileCount=394`, `unpackedSize=2.77 MB` (well under 30 MB)
- `_npmUser=awcartagena` (matches operator)
- `dist.signatures` present (registry signing only); `attestations` absent — drift documented

## Behavior correctness

- P4 contract sections 4.1-4.5 satisfied; 4.4 provenance requirement formally drifted via D157.
- D135 envelope unchanged.
- Pre-P4 gaps not regressed by this marker-only diff.
- `scripts/bootstrap.mjs` untouched (D150 honored).

## Concerns / WARN-level

1. **`scripts/release.mjs:30` still hardcodes `--provenance`.** With the same env (private repo, no OIDC), the next `pnpm release:publish` will fail identically. D157 calls out the OIDC follow-up but the script wasn't softened or gated, so the operator must remember to either configure OIDC first or bypass the script for `0.1.1`. Worth flagging in D157's follow-up checklist or as an inline TODO in `release.mjs`.
2. **D157 wording is permissive.** "Future OIDC publishes improve authentication but still will not produce npm provenance attestations" + "A provenance guarantee requires a public source repository" — true, but consider explicitly committing to either (a) make repo public before next release, or (b) record each future no-provenance publish as a fresh decision. Otherwise D157 risks becoming standing precedent.
3. **Dep version sanity** (informational only): `commander@14.0.3`, `hono@4.12.10`, `zod@4.3.6`, `@anthropic-ai/claude-agent-sdk@0.2.119`, `@openai/codex-sdk@0.118.0` — these are unusual version numbers vs. typical late-2025 ranges. Assuming the supply-chain audit (D152/relevant) covered these; if not yet audited at exactly these versions, worth double-checking before `0.1.1`.

# VERDICT

**PASS (with WARN)** — P4 ships honestly. The provenance drift is explicit, documented, and reversible. Strict supply-chain gates pass; live registry data matches evidence; tarball is clean. WARN items are follow-ups, not blockers.

# SUGGESTED CMDS

```sh
# Re-verify nothing leaked or got sideloaded vs. local:
diff <(npm view ductum@0.1.0 --json | jq -S .dependencies) \
     <(jq -S .dependencies packages/ductum/package.json)

# Confirm no attestation (sanity for D157):
npm view ductum@0.1.0 --json | jq '.dist | {integrity, signatures, attestations}'

# Inspect the published tarball end-to-end one more time before P5:
npm pack ductum@0.1.0 --registry=https://registry.npmjs.org/ \
  && tar -tzf ductum-0.1.0.tgz | grep -E '\.(ts|map|env|test\.)' || echo "clean"

# Add a guardrail before the next publish — make release.mjs's --provenance
# conditional on a flag so 0.1.1 doesn't fail by default until OIDC is wired:
#   node scripts/release.mjs publish --no-provenance   # explicit drift, logs reason
# (operator decision; not required to merge P4)
```
