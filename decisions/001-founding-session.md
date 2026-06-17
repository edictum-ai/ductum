# Decisions — Founding Design Session

**Date:** 2026-04-04
**Participants:** Arnold + Claude
**Context:** Anthropic announced third-party harness billing changes (OpenClaw decoupled from Claude Max subscription starting April 4). This triggered a re-evaluation of the AI factory architecture and led to the founding design of Ductum.

---

## D1: Replace OpenClaw with Claude Code headless

**Context:** Anthropic decoupled third-party harnesses (including OpenClaw) from Claude subscription limits. Claude Code, Claude Code headless, and Agent SDK remain covered by the Max subscription.
**Decision:** Use Claude Code headless as the primary builder agent harness instead of OpenClaw.
**Decided by:** Arnold
**Alternatives:** Continue with OpenClaw on pay-as-you-go (rejected: unknown cost), downgrade to Pro plan (rejected: loses headless access).

## D2: Ductum is a local-first app, future SaaS

**Context:** Three options considered — convention/file structure (Option A), local-first app (Option B), SaaS from day one (Option C).
**Decision:** Option B (local-first app) with a path to Option C (SaaS) later.
**Decided by:** Arnold
**Rationale:** Option A doesn't solve the enforcement problem (advisory CLAUDE.md instructions). Option C competes with shipping Edictum. Option B fixes the daily pain and dogfoods Edictum.

## D3: TypeScript for Ductum Core, layered architecture

**Context:** Three stack options — Python monolith, Go backend, or layered (TS orchestrator + Go edictum-api for enforcement).
**Decision:** Option 3 (layered). Ductum Core in TypeScript. edictum-api (Go) as the enforcement backend.
**Decided by:** Arnold
**Rationale:** Mirrors the product relationship (Ductum built ON edictum-api). Same language as the React frontend. edictum-api is already a standalone service that handles rules, gates, and audit.

## D4: Ductum is an AI factory model, not a project management tool

**Context:** Initial file structure proposal resembled Jira-with-markdown. Arnold correctly identified this was the wrong primitive.
**Decision:** Ductum is a running application that orchestrates AI agent factories, powered by Edictum for enforcement.
**Decided by:** Arnold
**Rationale:** The file structure was an implementation detail. The product is the orchestration engine + dashboard + agent integration.

## D5: Agents are assigned at the project level

**Context:** Initial design had agents assigned per-task only.
**Decision:** Agents are assigned to projects with roles (builder, reviewer, docs). Tasks can further refine assignment.
**Decided by:** Arnold
**Rationale:** Reflects reality — Mimi is always the builder on Edictum, Codex is always the reviewer. Project-level assignment with task-level overrides.

## D6: Specs can depend on other specs

**Context:** Initial design only had task-level dependencies within a spec.
**Decision:** Specs can have hard dependencies (blocks start) and soft relations (contextual link, no blocking) on other specs.
**Decided by:** Arnold
**Rationale:** Real example — spec 018 (mission control) depends on spec 017 (e2e demo). Spec 008 (workflow gates) is related to spec 016 (guarded worker) but not blocking.

## D7: MCP server + CLI as dual agent interface

**Context:** MCP has token overhead (~800-1200 tokens of tool definitions). CLI through bash is lighter but messier.
**Decision:** Both. MCP server and CLI are thin clients of the same Ductum Core REST API.
**Decided by:** Arnold + Claude
**Rationale:** All three agents support MCP natively. CLI exists for human use, scripting, and automation. Both are stateless wrappers — no logic duplication.

## D8: Agents can merge PRs, gated by Edictum rules

**Context:** Should agents be allowed to merge?
**Decision:** Yes. Merge is a workflow stage with its own gate rules. Auto-merge when CI + review pass. Human-merge when gate requires human_approval. Configurable per-project and per-task.
**Decided by:** Arnold
**Rationale:** The point is removing the human from the loop on work that passed all gates. Critical paths (cross-repo changes, releases) can require human approval.

## D9: Ductum needs agent skills/plugins

**Context:** Agents need to know how to interact with Ductum — when to call which tools, how to report decisions, what gate rules to expect.
**Decision:** Ductum will provide skills/plugins (SKILL.md, CLAUDE.md sections, or equivalent) that teach agents the Ductum workflow.
**Decided by:** Arnold
**Status:** Open design question — format and distribution mechanism TBD.
