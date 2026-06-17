# P12 - Codex Elicitation Request Handling

## Problem

Dogfood review run `ZgiJZXBQII1x` hit a Codex app-server request that Ductum
does not handle:

```txt
mcpServer/elicitation/request
```

The harness defaulted to `{}` for unknown server requests. Codex then reported:

```txt
failed to deserialize McpServerElicitationRequestResponse: missing field action
```

The run failed in `understand` instead of producing a useful Ductum-visible
blocker. This is a product failure: an agent-first factory cannot crash on a
non-interactive MCP elicitation path or leave the operator to infer the next
step from stderr.

## Behavior Contract

- `mcpServer/elicitation/request` must receive a protocol-valid non-interactive
  response:
  `{ action: "decline", content: null, _meta: null }`.
- The harness must emit Ductum evidence/activity that says the elicitation was
  declined because Ductum runs are non-interactive, including the server name
  and message when present.
- The Codex app-server process must not crash or fail JSON deserialization when
  an MCP elicitation request arrives.
- `item/tool/requestUserInput` must also receive a protocol-valid
  non-interactive response (`{ answers: {} }`) rather than falling through to
  `{}`.
- Unknown server requests must no longer silently return `{}` when the generated
  app-server protocol declares a shaped response. Either handle the known
  request explicitly or return a deliberate, schema-safe blocker.
- Keep `authorize_tool` harness-internal and `gate_check` read-only. Do not add
  a second policy path, table, dependency, or prompt-only workaround.
- Do not grow `packages/harness/src/codex-app-server.ts` further if avoidable;
  extract response shaping into a small testable helper module.

## Protocol Reference

Verified from:

```sh
codex app-server generate-ts --out /tmp/ductum-codex-app-ts
```

Relevant generated types:

```ts
export type McpServerElicitationRequestResponse = {
  action: "accept" | "decline" | "cancel";
  content: JsonValue | null;
  _meta: JsonValue | null;
};

export type ToolRequestUserInputResponse = {
  answers: { [key in string]?: ToolRequestUserInputAnswer };
};
```

## Decision Trace

- Decision `053`: work remains represented as Specs, Tasks, Runs, Decisions,
  and Evidence.
- Decision `054`: harness adapters normalize provider events to canonical
  Ductum events without owning policy.
- Decision `056`: sandbox and command boundaries remain structural controls.
- Decision `060`: dogfood drift must become an explicit task with evidence.
- Decision `108`: execution integrity and evidence truthfulness are
  operator-visible trust surfaces.

## Verification

```sh
pnpm --filter @ductum/harness test -- codex-app-server
pnpm build
pnpm test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

## Drift Handling

- Record a Ductum Decision before changing the workflow model or making MCP
  elicitation interactive by default.
- Do not make prompt instructions responsible for avoiding elicitation.
- If Codex has changed response schemas again, update this task with the new
  generated type evidence before implementing.

## Slop Review

- Attack any fix that only hides stderr without sending the required response
  shape.
- Attack any fix that accepts elicitation or grants permissions automatically.
- Attack untested private-method changes in the harness; response shaping should
  be directly unit-testable.
- Attack a generic `{}` fallback for server requests whose response schema is
  known.
