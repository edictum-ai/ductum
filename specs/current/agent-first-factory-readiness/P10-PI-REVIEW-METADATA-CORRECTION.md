Decision Trace: 052, 054, 058, 080, 108.

## Behavior Contract

- Fix the Pi dependency review artifact with the verified npm metadata below.
- Do not add, install, or import any Pi package.
- Preserve the verdict: Pi is not implemented and remains blocked.
- Remove claims that the three Pi packages are out of lockstep today. The current verified npm result is that all three are at `0.70.6`.
- Keep the real blockers: broad semver ranges, provider SDK breadth, fresh publish cadence, no Ductum harness export, no normal config path, no default harness change, and no marketplace/plugin-system detour.
- Mention that a prior Ductum Codex fix run could not reach npm/GitHub from its worktree, while the operator verified npm metadata from the root shell. Treat that as a dogfood blocker, not as proof that npm metadata is unavailable.

## Verified Metadata

Verified by the operator on 2026-04-30 with the exact npm commands required by P9:

### `@mariozechner/pi-coding-agent`

- version: `0.70.6`
- license: `MIT`
- repository: `git+https://github.com/badlogic/pi-mono.git`, directory `packages/coding-agent`
- dist integrity: `sha512-S4hUZghBeHPqsL6+DNg/TbGLziSh5+/mEHPVlYq5y6ImirWXhISLdLCnyZUW83OblKWihmG7unhJXiHQTH82mQ==`
- selected dependencies:
  - `@mariozechner/pi-agent-core: ^0.70.6`
  - `@mariozechner/pi-ai: ^0.70.6`
  - `@mariozechner/pi-tui: ^0.70.6`
  - `@silvia-odwyer/photon-node: ^0.3.4`
  - `undici: ^7.19.1`
  - `extract-zip: ^2.0.1`
  - `proper-lockfile: ^4.1.2`

### `@mariozechner/pi-agent-core`

- version: `0.70.6`
- license: `MIT`
- repository: `git+https://github.com/badlogic/pi-mono.git`, directory `packages/agent`
- dist integrity: `sha512-PovJZJqhY4ajgTJRUcLzfWKnlQuJHxHW3T030CafR9LYeLmOHi/HGS8DbCdRgSJNbnoIG+kl67/7++9DKZ2+sg==`
- dependencies:
  - `@mariozechner/pi-ai: ^0.70.6`
  - `typebox: ^1.1.24`

### `@mariozechner/pi-ai`

- version: `0.70.6`
- license: `MIT`
- repository: `git+https://github.com/badlogic/pi-mono.git`, directory `packages/ai`
- dist integrity: `sha512-LVAadu0Y+hb7Bj7EDiLsx6AuGxHlxDq0euLzyqX698i9qt0BW6a+oQSUIZQz4rJwExF18OvyL7ygJ5781ojrIQ==`
- selected dependencies:
  - `@anthropic-ai/sdk: ^0.90.0`
  - `@aws-sdk/client-bedrock-runtime: ^3.1030.0`
  - `@google/genai: ^1.40.0`
  - `@mistralai/mistralai: ^2.2.0`
  - `openai: 6.26.0`
  - `proxy-agent: ^6.5.0`
  - `undici: ^7.19.1`
  - `zod-to-json-schema: ^3.24.6`

## Verification

- Run `git diff --check`.
- Run `node packages/cli/dist/index.js operator brief --json`.
- Run `node packages/cli/dist/index.js integrity --json`.

## Drift Handling

- Record a Ductum Decision before adding any Pi dependency or runtime behavior.
- Do not add a provider marketplace, generic plugin system, or second policy path.
- Keep Edictum as the policy boundary.

## Slop Review

- Attack stale version claims.
- Attack any wording that implies Pi is implemented.
- Attack any wording that implies broad semver ranges are safe just because the current latest versions are lockstep.
- Attack any wording that hides the Codex harness DNS/workflow-stage blocker exposed by the failed fix run.

Task: Replace the stale Pi dependency review with a corrected artifact using the verified metadata above. This is docs-only; no dependency or adapter code should be added.
