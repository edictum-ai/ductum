# P5 Exit Demo Protocol

This is the operator-run proof for D131's deferred wall-clock claim. It is
not a CI check and it is not run from a Ductum source checkout.

## Preconditions

- Fresh physical machine, fresh user account, clean VM, or clean
  container snapshot.
- Node 22+ and pnpm 10+ available.
- No `ANTHROPIC_*`, `OPENAI_*`, `GH_TOKEN`, `GITHUB_TOKEN`,
  `COPILOT_*`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`,
  `ZAI_API_KEY`, or `OPENROUTER_API_KEY` environment variables.
- No `~/.claude/` directory.
- No previous global Ductum install.
- Harness files present as a small copied artifact, not a cloned Ductum
  source repo:
  - `scripts/demos/exit-demo-redo.mjs`
  - `scripts/demos/exit-demo-redo-lib.mjs`
  - `scripts/demos/exit-demo.mjs`

## Command

```sh
node scripts/demos/exit-demo-redo.mjs --json --package ductum@0.1.0
```

The harness writes evidence under:

```sh
/tmp/exit-demo-redo-evidence/<timestamp>/
```

The canonical success artifact inside that directory is
`p5-exit-demo.json`. After the operator returns that file, the closure
commit records the same payload at
`specs/current/bootstrap-redesign/evidence/p5-exit-demo.json`.

## Operator Flow

The harness starts the clock before global install, then runs:

```sh
pnpm install -g ductum@0.1.0
ductum init
```

In `ductum init`, use the documented default path:

- Continue through the intro.
- Directory: default `~/ductum`.
- Project name: default `factory`.
- Confirm scaffold.
- Anthropic auth: sign in, approve in the browser, let the callback
  complete.
- Codex auth: skip.
- Copilot auth: skip.
- Agent picker: select only `claude-builder`.
- Start dashboard: yes.

When `/welcome` opens, click **Import sample spec (hello-readme)**. The
sample prompt is:

```text
Append the line `Bootstrap proof: hello from Ductum.` to `README.md`.
Place it at the end of the file as a single new line.
After editing, verify the diff shows only that one appended line.
Do not touch any other file.
```

The harness then waits for the run to reach `awaiting_approval`. Click
exactly one approve button in the dashboard. The harness waits for the
merge, emits `p5-exit-demo.json`, validates the 600 second budget, and
attaches the payload as evidence type `exit_demo.run`.

## Pass Criteria

- `p5-exit-demo.json` exists and has `kind: "exit_demo.run"`.
- `totalSeconds < 600`.
- Timeline phases are present in order:
  `install_g`, `init_anthropic_auth`, `serve_ready`, `spec_imported`,
  `run_awaiting_approval`, `approve_clicked`, `merged`.
- `mergedBranch` is `main`.
- `operatorActions` is exactly `["browser_auth", "approve_click"]`.
- The evidence attach succeeds through
  `ductum evidence --type exit_demo.run`.

If any item fails, do not close the bootstrap-redesign arc. Keep the
evidence directory and record the named blocker.
