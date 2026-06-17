# D52: Pi as a future unified harness

**Date:** 2026-04-25 (metadata corrected 2026-04-30)
**Context:** We want the factory to be agent-first and possibly converge on one harness instead of separate Claude/Codex/provider-specific adapters. Arnold pointed at `badlogic/pi-mono`, especially `packages/coding-agent`, as a candidate.
**Decided by:** Arnold + Codex

## Findings

Pi is a real candidate for a future Ductum harness:

- It has interactive, print, JSON event stream, RPC, and SDK modes.
- It supports subscription login for Claude, Codex/OpenAI, Copilot, Gemini CLI, and Antigravity, plus API-key providers including ZAI.
- Its SDK exposes `createAgentSession`, session events, model control, thinking levels, compaction, abort, queueing, and custom tools.
- Its built-in tools cover `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
- Extensions can register tools, providers, slash commands, UI, permission gates, prompt transforms, bash spawn hooks, and subagent workflows.
- RPC and JSON modes expose machine-readable event streams suitable for Ductum run activity.
- Extension `tool_call` events can block tool execution, and `tool_result` events can patch results before they are emitted. That gives Ductum a plausible structural gate point for Edictum.
- The README explicitly points to `openclaw/openclaw` as a real-world SDK integration, which matches our direction: a factory/operator product embedding a coding-agent runtime instead of shelling out forever.

## Verified npm metadata (2026-04-30)

Verified by the operator from the root shell using the exact npm commands from P9.
All three packages are currently at the same version: `0.70.6`, license `MIT`, published from the same mono repo.

**Important:** current lockstep at `0.70.6` does not make the broad semver ranges safe. The `^` ranges below mean that any future minor or patch bump resolves differently on every install. Lockstep is a snapshot observation, not a guarantee.

### `@mariozechner/pi-coding-agent` `0.70.6`

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

### `@mariozechner/pi-agent-core` `0.70.6`

- license: `MIT`
- repository: `git+https://github.com/badlogic/pi-mono.git`, directory `packages/agent`
- dist integrity: `sha512-PovJZJqhY4ajgTJRUcLzfWKnlQuJHxHW3T030CafR9LYeLmOHi/HGS8DbCdRgSJNbnoIG+kl67/7++9DKZ2+sg==`
- dependencies:
  - `@mariozechner/pi-ai: ^0.70.6`
  - `typebox: ^1.1.24`

### `@mariozechner/pi-ai` `0.70.6`

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

## Supply-chain risk assessment

Pi is not implemented in Ductum. No Pi package is installed, imported, or referenced in any adapter code. Pi remains blocked until the following risks are resolved:

1. **Broad semver ranges.** All three packages and most transitive dependencies use `^` ranges. Ductum's supply-chain rules require exact pins. Our root lockfile would pin the resolved tree, but the upstream ranges mean the resolved tree changes on every fresh install. Current lockstep at `0.70.6` is a point-in-time observation, not a durable property.

2. **Provider SDK breadth.** `@mariozechner/pi-ai` pulls in Anthropic, AWS Bedrock, Google GenAI, Mistral, and OpenAI SDKs. That is five provider runtimes Ductum does not need and would have to audit. Each `^` range adds transitive surface. `@aws-sdk/client-bedrock-runtime@^3.1030.0` alone brings a large dependency tree.

3. **Fresh publish cadence.** Pi releases frequently. The upstream moved from `0.70.2` to `0.70.6` in under a week. A dependency that changes this often needs continuous review, not a one-time check.

4. **No Ductum harness export.** Pi does not expose a stable library API for Ductum to embed as a harness. Decision 054 defines the harness interface; Pi would need an adapter implementing that interface. No such adapter exists.

5. **No normal config path.** There is no `ductum.yaml` entry or harness resource that can select Pi today. Adding one requires the harness registry from decision 054, the resource runtime from decision 080, and an adapter that passes the event contract.

6. **No default harness change.** The working `claude-agent-sdk`, `codex-sdk`, and `codex-app-server` adapters remain the production paths. Pi would be additive, behind a feature flag, and only after all blockers above are resolved.

7. **No marketplace or plugin-system detour.** Decisions 058, 080, and 108 are explicit: no generic provider marketplace, no plugin abstraction, no second policy path. Pi can only become a named harness adapter under Edictum enforcement.

## Dogfood blocker: Codex harness DNS/worktree isolation

A prior Ductum Codex fix run dispatched to correct this artifact could not reach npm or GitHub from its worktree. The operator verified the same npm metadata from the root shell without issue. This is a dogfood blocker for the Ductum harness layer: if a dispatched agent cannot reach the network resources it needs to do its work, the factory cannot trust dispatched metadata verification. The metadata below was verified by the operator, not by a dispatched run.

## Constraint

Pi is not a drop-in replacement for Ductum's harness layer:

- It intentionally has no built-in MCP.
- Permission gating is extension-driven, so Ductum still needs a structural adapter for Edictum gate checks.
- Ductum requires per-run session binding, tool authorization, tool result evidence recording, worktree isolation, heartbeat reporting, and completion parsing.
- Adding `@mariozechner/pi-coding-agent` is a supply-chain change and must be exact-pinned and reviewed before landing.
- The upstream packages declare many dependencies with semver ranges. This violates Ductum's exact-pin rule at the upstream level even though the root lockfile pins the resolved tree.

## Decision

Pi is not implemented and remains blocked.

For the demo hardening pass, do not replace the working `claude-agent-sdk`, `codex-sdk`, or `codex-app-server` adapters with Pi.

Do remove deprecated `vercel-ai` and `openai-agents` from the Settings/catalog surface so operators choose the real current paths. Keep old harness enum values in storage/core for historical rows and migrations until a dedicated cleanup migration exists.

The next safe step is a dedicated `pi-sdk` spike adapter behind a feature flag:

1. Use Pi SDK or RPC mode in a single Ductum harness adapter.
2. Pass Ductum worktree cwd and a strict allowed-tool set.
3. Register/override tools so every file/bash mutation goes through Edictum authorization before execution.
4. Stream Pi events into run activity.
5. Emit a terminating structured completion tool/result so review and ship routing stay deterministic.
6. Exact-pin the package and review transitive dependencies before merging.
7. Record a Ductum Decision before adding any Pi dependency or runtime behavior.

None of this proceeds until blockers 1-7 above are resolved.

## Sources inspected

- `https://github.com/badlogic/pi-mono`
- `/tmp/ductum-pi-mono/packages/coding-agent/README.md`
- `/tmp/ductum-pi-mono/packages/coding-agent/docs/sdk.md`
- `/tmp/ductum-pi-mono/packages/coding-agent/docs/rpc.md`
- `/tmp/ductum-pi-mono/packages/coding-agent/docs/json.md`
- `/tmp/ductum-pi-mono/packages/coding-agent/docs/extensions.md`
- npm registry verified by operator on 2026-04-30 (see Verified npm metadata above)
