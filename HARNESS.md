# Harness

How Ductum makes enforcement structural, not advisory.

Current direction: keep the enforcement principle, but move harnesses toward the
pluggable `HarnessAdapter` model in decisions `054` and `057`. Sandboxing is a
separate `SandboxProfile` resource, not a harness detail.

## The problem

If agents call Ductum MCP tools voluntarily, enforcement is advisory. An agent can:
- Skip `ductum.gate_check()` and push anyway
- Never call `ductum.update()` and go dark
- Ignore `ductum.wait()` and proceed without CI results
- Claim `ductum.complete()` without actually finishing

This recreates the exact failure Ductum exists to solve. CLAUDE.md says "you MUST call gate_check" and the agent says "No blocker. Just the same pause failure on my side."

**Enforcement must live in the harness, not in instructions to the agent.**

## Principle

The agent does not interact with the outside world directly. The harness mediates ALL tool calls. The harness can:

1. **Intercept** — every tool call passes through Ductum before execution
2. **Inject** — Ductum adds context, rules, and constraints to the agent’s environment
3. **Block** — Ductum can refuse tool calls that violate workflow state
4. **Report** — Ductum logs every action regardless of what the agent chooses to report

The agent’s freedom is within a stage. The transitions between stages are governed by the harness + @edictum/core, not by the agent’s judgment.

## Claude harness adapter

**Runtime:** Claude Agent SDK (TypeScript)
**Subscription:** Claude Max (covered, no extra usage billing)
**Used for:** Mimi (primary builder)

The Claude Agent SDK gives Ductum programmatic control over the agent session:

```
Ductum Core
  │
  ├─ Creates agent session via Agent SDK
  ├─ Injects system prompt with task context
  ├─ Registers available tools (file ops, git, bash, etc.)
  ├─ Wraps every tool call through @edictum/core:
  │     Agent wants to call `git push` →
  │     Harness checks: is current stage "pushing"?
  │     @edictum/core evaluates: allowed | blocked
  │     If blocked: tool call rejected, agent gets reason
  │     If allowed: tool call executes, event logged
  ├─ Monitors token usage per message
  ├─ Sends heartbeats automatically
  └─ Detects session end / crash, updates run state
```

**What the agent sees:** A normal Claude Code session with available tools. What the agent does NOT see: the harness intercepting and evaluating every tool call.

**What the agent cannot do:**
- Execute `git push` while in `implementing` stage (harness blocks it)
- Skip CI by calling `ductum.complete()` without evidence of CI pass (harness rejects)
- Go silent — heartbeats are automatic, stall detection is infrastructure

**Key capability:** The Agent SDK exposes the full message/tool-call loop programmatically. Ductum doesn’t just inject a system prompt and hope — it sits in the execution path.

## OpenCode harness adapter

**Runtime:** OpenCode server mode (`opencode serve`)
**Subscription:** OpenAI (for Codex), GLM (for GLM) — independent billing
**Used for:** Codex (reviewer), GLM (docs/quick-fix)

OpenCode exposes a full HTTP REST API and supports MCP servers and plugins.

### Plugin isolation model (D15)

OpenCode plugins load from config directories at startup, not dynamically per-session. The Ductum plugin is therefore **stateless and generic** — it does not contain per-run policy. Instead, it delegates all policy decisions to Ductum Core:

```
OpenCode Plugin (stateless)                Ductum Core (session-aware)
  │                                            │
  ├─ Agent wants to call `bash git push`        │
  ├─ Plugin fires before_tool_call hook          │
  ├─ Plugin sends session identity ──────────▶  │
  │                                            ├─ Resolves session to run
  │                                            ├─ Looks up run workflow
  │                                            ├─ Current stage: implementing
  │                                            ├─ Target action: git push
  │                                            ├─ @edictum/core: BLOCKED
  │  ◀────────── { blocked, reason } ────────┘
  ├─ Plugin rejects tool call
  └─ Agent receives block reason
```

The plugin is the same for every run on the same server. The policy is
different per-run because Ductum Core resolves session identity against its own
state. No per-run plugin injection needed.

**When isolation requires dedicated servers:** If two concurrent runs have
conflicting tool permissions, the stateless plugin can handle it as long as each
tool call has reliable session identity. Dedicated servers are only needed if
the runtime itself has conflicting per-session state, such as working
directories or credentials.

### Integration flow

```
Ductum Core
  │
  ├─ Starts `opencode serve --port {N}` with model config
  ├─ Ductum plugin loaded from config dir at startup
  ├─ Ductum MCP server registered in OpenCode config
  ├─ Creates session via REST API: POST /sessions
  ├─ Sends task prompt through a session already bound to the run
  ├─ Monitors session via REST API (status, token usage)
  ├─ Sends heartbeats based on session activity
  └─ Detects session end / crash, updates run state
```

### Hot factory pattern

```bash
# Persistent server on Mac Mini (stays warm)
opencode serve --port 4097 --hostname 0.0.0.0

# Ductum dispatches by attaching to warm server
opencode run --attach http://macmini:4097 "task prompt"
```

No MCP cold boot, no context loading delay. The factory is always hot.

## Enforcement boundary

**Within a stage:** the agent has freedom. It can write code, run tests, read files, think. These are normal tool calls that the harness allows.

**Between stages:** the harness + @edictum/core govern transitions. The agent cannot advance from `implementing` to `pushing` without the gate allowing it. The agent cannot claim `complete` without evidence.

**This maps to Edictum’s design:** rules govern tool calls (inner-loop enforcement), workflow gates govern stage transitions (outer-loop enforcement). The harness is the runtime that connects both.

## What this is NOT

- Not a SKILL.md that agents read and hopefully follow
- Not a CLAUDE.md section that agents might ignore
- Not prompt injection that agents can reason around
- Not MCP tool descriptions that agents can choose not to call

It IS infrastructure-level interception. The agent’s tool calls pass through Ductum’s enforcement layer the same way HTTP requests pass through a firewall. The agent doesn’t get a choice.

## Open design work

1. **Claude Agent SDK tool-call interception API:** How exactly does the SDK expose the tool-call loop for wrapping? Need to verify the actual API surface. (Codex notes the SDK docs likely answer this already.)
2. **OpenCode plugin crash resilience:** What happens if the Ductum plugin fails to load or crashes mid-session? The agent would run unmonitored. Need a circuit breaker: Ductum Core detects missing heartbeats and kills the OpenCode session.
3. **Mixed-harness coordination:** When Mimi (Claude) builds and Codex (OpenCode) reviews, the handoff between harnesses needs a clean protocol. Ductum Core mediates, but the evidence format must be compatible.
4. **Token cost attribution:** Claude Agent SDK gives token counts per message. OpenCode `session stats` gives aggregate counts. Ductum needs to normalize these into a consistent cost model.
