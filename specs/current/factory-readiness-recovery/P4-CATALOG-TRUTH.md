# P4 - Catalog Truth (dogfood)

## Problem

The factory's resource catalog does not match reality:

- Models in factory DB: `gpt-54` only. Models the factory uses every
  day: `claude-sonnet-4-6`, `claude-opus-4-7`, `gpt-5.4`, `glm-5.1`.
- Harnesses in factory DB: `codex-sdk` only. Harnesses the factory
  uses every day: `claude-agent-sdk`, `codex-sdk`, `codex-app-server`,
  `copilot-sdk`.
- NotificationChannel resources: zero. Telegram is configured in env
  but has never been end-to-end tested. The dogfood spec
  `telegram-settings-next-step-ui.yml` was never imported.
- Pi is decision-blocked (D52) with seven supply-chain risks but the
  doctor surface and the dashboard say nothing about Pi. Operators
  must read `decisions/052-pi-harness-evaluation.md` to know.
- `glm` is half-removed (still in agent table for foreign-key audit;
  no longer in any project pool; yaml no longer declares it).

## Scope

Dispatched through Ductum.

## Behavior Contract

### 4.1 `register-claude-models-as-resources`

- `claude-sonnet-4-6`, `claude-opus-4-7` become `Model` resources
  declared in `ductum.yaml` `models:` and persisted via
  `ductum config apply`.
- Agent yaml entries reference Model resources by name, not raw model
  strings.
- Doctor verifies each declared model is reachable via its declared
  harness.

### 4.2 `register-claude-agent-sdk-harness`

- `claude-agent-sdk`, `codex-app-server`, `copilot-sdk` become
  `Harness` resources declared in `ductum.yaml` `harnesses:`.
- The dashboard harness combobox in the agent panel reads from these
  registered Harness resources (this completes P2 task
  `dashboard-harness-source-of-truth`).

### 4.3 `pi-availability-doctor-check`

- Doctor reports a named, structured "Pi: not available — see
  Decision 052" check, not a silent omission.
- The dashboard agent / harness pickers explicitly list Pi as
  "blocked, see D52" so operators see it without reading decisions.

### 4.4 `notificationchannel-telegram-wizard`

- The Telegram settings panel gains a "Discover chat id" button that
  calls `ductum telegram chats` and pastes the result into the form.
- The Telegram settings panel gains a "Test send" button that posts a
  real message via the configured bot. Telegram is end-to-end verified
  for the first time as part of this task's exit demo.
- An "Add Telegram channel" wizard creates a `NotificationChannel`
  resource that ties to the Telegram settings panel above.
- After this task lands, NotificationChannel table has at least one
  row and a real round-trip approval reaches the operator's chat.

### 4.5 `glm-removal-followup`

Decide one of:
- Delete `glm` agent row (will cascade-fail because of historical run
  foreign keys; needs a migration or evidence-keep).
- OR add explicit OpenRouter routing in claude-agent-sdk so glm-5.1
  becomes reachable again, then re-add to the project pool.

The chosen path is recorded as a Decision under `decisions/`.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
node packages/cli/dist/index.js doctor --json
node packages/cli/dist/index.js resource list Model --json
node packages/cli/dist/index.js resource list Harness --json
node packages/cli/dist/index.js resource list NotificationChannel --json
```

## Exit Demo

1. `ductum doctor` is fully green or honestly amber with named blockers.
   No false positives.
2. `ductum resource list Model` shows all four models, not one.
3. `ductum resource list Harness` shows all four harnesses, not one.
4. I approve a test run from the dashboard; my Telegram receives the
   approval message; I tap approve in Telegram; the merge happens.
5. `ductum resource list NotificationChannel` shows the Telegram channel.

## Slop Review

- Attack any catalog entry that exists in resources but isn't actually
  used. Catalog must reflect runtime reality.
- Attack a "Pi" surface that says "blocked" without linking to D52.
- Attack a Telegram wizard that ships without an end-to-end approval
  round-trip in the exit demo.
