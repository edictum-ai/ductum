# Ductum OpenCode Plugin

OpenCode loads local plugins from the directories documented at
`https://opencode.ai/docs/plugins/`:

- Project scope: `.opencode/plugins/`
- Global scope: `~/.config/opencode/plugins/`

Build the harness package first so `dist/plugin/index.js` exists, then copy or symlink it
into one of those plugin directories.

```bash
mkdir -p ~/.config/opencode/plugins
ln -sf \
  "$(pwd)/packages/harness/dist/plugin/index.js" \
  ~/.config/opencode/plugins/ductum.js
```

The plugin is stateless. It reads `DUCTUM_API_URL` from the OpenCode process environment and
delegates every tool authorization decision to Ductum Core.

```bash
export DUCTUM_API_URL=http://localhost:4100
```

Behavior:

- `tool.execute.before` calls `POST /api/internal/authorize-tool` with
  `{ session_id, tool, args }`
- blocked tool calls throw an error, which is how OpenCode plugins actually stop execution
- network or API failures fail closed and block the tool call

The P8 prompt references `/sessions`, `/tool-call`, and `/stats`. The current OpenCode docs
and server source use `/session`, `/session/:id/message` or `/prompt_async`, and expose
token/cost data through session message history instead of a dedicated stats endpoint.
