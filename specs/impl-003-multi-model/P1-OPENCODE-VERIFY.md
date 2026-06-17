# P1: OpenCode Adapter Verification

**Scope:** Test the OpenCode harness adapter against a live OpenCode instance
**Package:** `packages/harness`
**Depends on:** None
**Deliverable:** GPT 5.4 completes a task dispatched through Ductum

---

## Required Reading

- `packages/harness/src/opencode.ts` — main adapter (273 lines)
- `packages/harness/src/opencode-rest.ts` — HTTP API client (191 lines)
- `packages/harness/src/opencode-model.ts` — model name mapping (26 lines)
- `packages/harness/src/opencode-probe.ts` — plugin health probe (75 lines)
- `packages/harness/src/tests/opencode.test.ts` — existing mock tests
- OpenCode documentation at ~/.opencode/config.yaml (check format)

## Tasks

### 1. Verify OpenCode is installed and running

```bash
# Check OpenCode is available
which opencode
opencode --version

# Start OpenCode serve mode (required for Ductum adapter)
opencode serve --port 4097
```

If OpenCode is not installed, document the installation steps.

### 2. Verify model name mapping

Check `opencode-model.ts` — does it map `openai/gpt-5.4` and `zai-coding-plan/glm-5v-turbo` correctly?
The resolver splits on `/` to get providerID and modelID. Verify these match
what OpenCode expects.
If not, update the mapping.

### 3. Test session lifecycle

Write an integration test (or manual test script) that:
1. Creates an OpenCode session
2. Attaches the Ductum MCP server
3. Sends a simple prompt ("Create a file called test.txt with 'hello'")
4. Polls for completion
5. Verifies the session completes without error

### 4. Fix any issues found

Common issues to watch for:
- OpenCode API URL/port mismatch
- MCP server attachment format differences
- Session creation parameters
- Model name not recognized by OpenCode
- Auth/API key not passed through

### 5. End-to-end dispatch test

Use `ductum run` or the dispatcher to dispatch a simple task to `codex` agent:
```bash
# Create a simple test task and dispatch to codex (CLI takes task name, not ID)
node packages/cli/dist/index.js run <task-name> --agent codex
```

## Verification

- [ ] OpenCode session creates successfully
- [ ] MCP server attaches (ductum tools visible to the agent)
- [ ] Simple task completes through GPT 5.4
- [ ] Session completion is detected by the adapter
- [ ] No crashes or unhandled errors in the adapter
