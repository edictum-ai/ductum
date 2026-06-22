# Telegram Deploy Readiness Truthfulness

## Intake

`ductum doctor --deploy` can say `telegram webhook: webhook not set` while
Telegram already has the expected webhook registered, because runtime status has
no `webhookUrl` until `TELEGRAM_CHAT_ID` is configured. This duplicates and
mislabels the actual blocker: chat id bootstrap.

## Grill Questions

- Should doctor call Telegram `getWebhookInfo`? No. Decision `091` kept deploy
  doctor API-backed and local/read-only.
- Should doctor set or delete webhooks? No. Those remain explicit
  `ductum telegram webhook ...` commands.
- Should missing chat id still block deploy readiness? Yes. Telegram runtime and
  env checks must remain loud failures.
- What should change? The webhook check should stop claiming an unset webhook
  when runtime is still waiting for chat id, and Telegram guidance should use
  deployment-neutral restart wording.

## Decisions

- Add decision `095` for truthful Telegram deploy readiness during chat id
  bootstrap.
- Treat runtime `missing: ["chatId"]` plus null `webhookUrl` as a pending
  webhook check, not an unset webhook.
- Preserve `webhook not set` failure for otherwise-active Telegram runtime.
- Keep doctor read-only and free of Telegram API calls.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `091`,
  `093`, `094`, and `095`.
- Non-goals: no Telegram API calls from doctor, webhook mutation, new table,
  dependency, provider branch, Edictum change, or second policy system.
- Allowed scope: CLI doctor readiness messages, deploy webhook check
  classification, tests, dogfood records, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/telegram-deploy-readiness-truthfulness --path`,
  `ductum spec drift-review ductum telegram-deploy-readiness-truthfulness`,
  `pnpm --filter @ductum/cli test`, `pnpm build`, `git diff --check`, and
  adversarial slop review.
- Drift handling: record a new decision before doctor calls Telegram, mutates
  webhooks, stores chat state, or changes notification runtime behavior.

## Behavior Contract

- CLI `doctor --deploy` must not report `telegram webhook: webhook not set` solely
  because Telegram runtime is waiting for `chatId`.
- CLI `doctor --deploy` must still fail loudly on missing `TELEGRAM_CHAT_ID` through
  runtime/env checks.
- CLI `doctor --deploy` must fail loudly when Telegram runtime is enabled but no
  webhook URL is known and no chat-id-bootstrap blocker explains it.
- CLI `doctor --deploy` must mark the webhook check as pending/warn when webhook
  status cannot be trusted until chat id bootstrap finishes.
- CLI `doctor --deploy` must preserve the existing `webhook not set` failure when
  Telegram runtime is otherwise active and no webhook URL is known.
- CLI `doctor --deploy` must preserve mismatch warning behavior when a known
  webhook URL differs from the expected public URL.
- Telegram readiness fixes must say to restart the Ductum API, not `pnpm serve`.
- Chat id bootstrap guidance must point operators at `ductum telegram chats`
  and the explicit webhook-delete recovery path when polling is blocked.
- CLI doctor must not call Telegram APIs directly.
- CLI doctor must not set or delete Telegram webhooks.
- CLI doctor must not silently downgrade missing chat id runtime/env failures.
- CLI doctor must not swallow API errors from Telegram runtime status into a passing
  deploy report.
- Output must not leak bot tokens, webhook secrets, operator tokens, or chat ids
  beyond already operator-provided/discovered values.
- The slice must not change Telegram send/webhook runtime behavior.
- The slice must not add dependencies, tables, provider branches, or policy
  behavior.
- Tests must prove behavior, not only output shape.

## Slop Review

- Did every Behavior Contract item get behavioral tests or explicit evidence?
- Are tests behavioral, not just shape checks?
- Did reviewers attack shape-correct but behavior-empty doctor output?
- Does deploy doctor remain read-only and free of Telegram API calls?
- Are missing chat id failures still loud?
- Are API/runtime status errors still loud failures?
- Did the webhook check stop lying while preserving true webhook failures?
- Did tests assert behavior and not only message shape?
- Did any path mutate Telegram webhook state?
- Did any path silently pass deploy readiness with missing chat id?
- Did output avoid secret leakage?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-TELEGRAM-DEPLOY-READINESS-TRUTHFULNESS.md](P1-TELEGRAM-DEPLOY-READINESS-TRUTHFULNESS.md) | cli | Doctor deploy Telegram readiness classification, guidance, tests, evidence | [x] | - |

## Dogfood Record

- Imported spec `PD00Ejk_2xUx`.
- Imported task `s2INH_vfdKwp`.
- Dogfood run `EvM6C97d9SJo`.
- Recorded decision `MoQjRBYeEMzY`.
- Recorded evidence:
  - `YHJ_ffnlCX-5`: spec contract check.
  - `Bn1LNClh2zHA` and `pePnkcoRvFmJ`: CLI test passes, final count 241.
  - `IE3hniRkEewC` and `jHYDt5blykUS`: build, contract-check,
    drift-review, and diff checks.
  - `557aIl73XNUv` and `mpqztb5yb_Ss`: live deploy doctor smoke.
  - `rdc_eqmvPF3y`: Claude slop review PASS, fixes applied.
- Drift: none for this slice. Claude noted non-Telegram `pnpm serve` deploy
  guidance as an explicit follow-up candidate outside decision `095`.

## Verification

```sh
ductum spec contract-check ductum specs/current/telegram-deploy-readiness-truthfulness --path
ductum spec drift-review ductum telegram-deploy-readiness-truthfulness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
