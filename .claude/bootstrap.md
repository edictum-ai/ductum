# Ductum — Session Bootstrap

Read these files in this order before doing anything:

1. `.claude/handover.md` — full technical handover, implementation plan, session prompts
2. `CLAUDE.md` — project rules, design constraints, decisions
3. `specs/impl-009-edictum-integration/spec.md` — THE critical spec (Edictum as governance layer)

## Quick context

Ductum is a governed agentic software factory powered by Edictum. It dispatches AI agents to tasks, enforces workflow stages they cannot bypass, and provides real-time visibility. Multi-model: Claude Opus, GPT 5.4, GLM via OpenCode.

9 implementation specs are written and reviewed (32 prompts). impl-009 goes first — it makes Edictum the lifecycle, not a sidecar. The handover has exact session prompts.

## How to start dev

```bash
cd /Users/acartagena/project/ductum
opencode serve --port 4097  # separate terminal — for GPT/GLM dispatch
pnpm build && pnpm serve    # needs ANTHROPIC_API_KEY in env
```

## Tests

```bash
pnpm -r test   # 163 tests, all should pass
```
