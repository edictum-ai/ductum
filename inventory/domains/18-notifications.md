# Notifications

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The notifications domain is effectively a single working capability: Telegram approval delivery + interactive approve/deny round-trip. It is well-tested (19 tests green), redacts secrets, and uniquely (vs dispatch) wires the FactorySecret/env resolver correctly. The weaknesses are all about shape, not correctness: D055's "pluggable channels" vision is unrealized (only the Telegram backend exists), the channel config still lives on the retired generic "resource"/ConfigResource surface, and a legacy DUCTUM_TELEGRAM_CONFIG env path runs in parallel to the resource-backed channel. The NotificationBackend interface is sound but currently single-implementation, so the abstraction earns REUSE rather than KEEP.

## Telegram approval delivery (notify + interactive approve/deny)
- **What:** Sends an HTML approval-request message with inline Approve/Deny buttons on `approval.requested`, and processes the button callback to approve/merge or reject the run. This is the one real notification + action capability in the repo.
- **Where:** `packages/api/src/lib/telegram.ts:70-202` (`TelegramApprovalNotifier`, `send`, `handleAction`, `editDecisionMessage`); event subscription in `packages/api/src/routes/telegram.ts:20-27`.
- **Maturity:** live-core
- **Quality:** solid — 19 domain tests pass (notification-channel-runtime, secrets, telegram-parity); HTML output is escaped (`html()` telegram.ts:257), errors and Telegram responses are run through `redactPublicText`, delivery recorded as typed `notification.delivery` evidence.
- **Operator-legibility risk:** none — `TelegramApprovalStatus.tsx` renders plain-English state and always advertises the CLI fallback.
- **Dependencies:** `approveRun`/`rejectRun` (run-ops/approval.ts), `resolveTelegramRuntime`, Telegram Bot API; relies on the chat-id allowlist in `handleAction` for authz.
- **Disposition (recommended):** KEEP — works end-to-end, fits the approvals wedge, well covered.
- **Flags:** `parseTelegramDecision` (telegram.ts:204-211) also accepts a loose 2-part `approve:<runId>` form in addition to the canonical `ductum:approve:<runId>`; harmless today only because `handleAction` rejects foreign chat ids, but it is legacy parsing slack worth tightening.

## Telegram webhook + setup endpoints (status / chats / test-send / webhook)
- **What:** HTTP surface for the webhook receiver (constant-time secret check), plus operator setup helpers: `/status`, `/chats` (server-side getUpdates so the token never reaches the browser), and `/test-send`.
- **Where:** `packages/api/src/routes/telegram.ts:29-135`; webhook secret compare `secretMatches` telegram.ts:138-142 (`timingSafeEqual`).
- **Maturity:** live-core
- **Quality:** solid — webhook uses timing-safe secret comparison, rejects disabled/misconfigured with 404/503, ignores non-callback updates; covered by telegram-parity routes test including the "another chat" rejection case.
- **Operator-legibility risk:** none — setup endpoints back a guided checklist in Factory Settings.
- **Dependencies:** `resolveTelegramRuntime`, Hono, Telegram Bot API.
- **Disposition (recommended):** KEEP — this is the proven approval round-trip surface.
- **Flags:** none.

## TelegramRuntime resolution + status (legacy vs resource)
- **What:** Resolves the effective Telegram config from either the legacy `DUCTUM_TELEGRAM_CONFIG` env blob (`source: 'legacy'`) or a referenced NotificationChannel resource (`source: 'resource'`), and computes the operator-facing status (enabled/configured/missing/webhookUrl).
- **Where:** `packages/api/src/lib/telegram-runtime.ts:35-146`; legacy env parse `parseTelegramConfig` (telegram.ts:31-68) wired at `packages/api/src/lib/deps.ts:268`.
- **Maturity:** live-peripheral
- **Quality:** adequate — correct and tested, but it carries a dual construction path (env-legacy and resource) plus a `failedTelegramRuntimeContext` fallback, which is more branching than the single supported model needs.
- **Operator-legibility risk:** partial — two config origins ("legacy" vs "resource") mean an operator can be configured via env and never see the channel in Factory Settings; the `source` field is mostly internal.
- **Dependencies:** `resolveNotificationChannelResource`, `assertTelegramChannel`, `FactorySecretResolver`.
- **Disposition (recommended):** REUSE — keep the resolver, but the legacy env branch should sit behind (and eventually be removed by) the resource-only boundary.
- **Flags:** legacy — `DUCTUM_TELEGRAM_CONFIG` env path (`source: 'legacy'`) is still live and parallels the resource-backed channel.

## NotificationChannel config + secret/env reference resolution
- **What:** Validates a telegram NotificationChannel spec and resolves `botToken`/`chatId`/`webhookSecret` from `${ENV}` or `secret:<id>` references via the encrypted FactorySecret store before any Telegram call; plaintext tokens are rejected.
- **Where:** `packages/api/src/lib/telegram-runtime.ts:114-182` (`telegramConfigFromChannel`, `resolveRuntimeValue`); channel lookup `packages/api/src/lib/notification-channels.ts:7-53`.
- **Maturity:** live-core
- **Quality:** solid — notification-channel-runtime-secrets.test.ts proves env + Ductum-secret refs resolve and are not leaked. Notably this is the one place the FactorySecret system is correctly wired (unlike dispatch, where secrets leak per the established findings).
- **Operator-legibility risk:** none — UI hints tell operators to use `${ENV}`/`secret:<id>`; redacted values shown as `[redacted]`.
- **Dependencies:** `FactorySecretResolver`, `isFactorySecretRef`, `isSafeEnvReference`, `context.repos.secrets`, `factoryDataDir`.
- **Disposition (recommended):** KEEP — secure-by-construction and tested.
- **Flags:** none (positive: the secret-resolution pattern here is the model dispatch should follow).

## NotificationBackend abstraction (D055 pluggable channels)
- **What:** The `NotificationBackend` interface (`send`/`supportsActions`/`handleAction`) plus message/action types, intended per D055 to make notifications pluggable across telegram/webhook/local/Slack/email.
- **Where:** `packages/api/src/lib/notification-backends.ts:36-41`; only implementor is `TelegramApprovalNotifier` (telegram.ts:70).
- **Maturity:** experimental
- **Quality:** adequate — clean, minimal interface, but single-implementation; `NotificationMessage` is hardcoded to `kind: 'approval.requested'` only, far narrower than D055's listed message/action set (run failed, stalled, spec completed, fan-out, etc.).
- **Operator-legibility risk:** none.
- **Dependencies:** consumed only by the telegram route registration.
- **Disposition (recommended):** REUSE — sound seam to keep, but it is an abstraction over exactly one backend; do not present it as a delivered multi-channel system.
- **Flags:** legacy/aspirational — D055 lists webhook/local/Slack/email backends that were never built; the broader message/action taxonomy is unimplemented.

## NotificationChannel CRUD surface (dashboard + resource route)
- **What:** Factory Settings panel to create/edit/delete telegram NotificationChannels, backed by the generic config-resource route and a factory catalog listing.
- **Where:** `packages/dashboard/src/settings/NotificationChannelsPanel.tsx`; route `/api/resources/NotificationChannel` (config-resources.ts), catalog `packages/api/src/routes/factory-catalogs.ts:15,40-41`.
- **Maturity:** live-peripheral
- **Quality:** adequate — functional CRUD with validation and redaction (settings-notification-channels.test.tsx); but it rides the retired generic "resource"/`ConfigResource` surface rather than a first-class Factory Settings entity.
- **Operator-legibility risk:** partial — the panel is clear, but the channel is stored/edited as a `ConfigResource` (`/api/resources/...`), a surface the operational-model redesign retired from normal use.
- **Dependencies:** `useNotificationChannelResources` hooks, `configResources` repo, `factory-catalogs` for `configured` status.
- **Disposition (recommended):** REUSE — the UI is fine; expect it to move off the generic resource route onto a typed Factory Settings boundary.
- **Flags:** legacy — built on the retired `resource`/`ConfigResource` surface (`/api/resources/NotificationChannel`, `context.repos.configResources`).

## Stale / orphaned approval recovery
- **What:** Lets an operator approve a run that stalled after a recoverable slot-GC / orphan-reattach failure by restoring `pendingApproval` state (with review-gate guard), plus a reconcile path and dashboard guidance helpers.
- **Where:** `packages/api/src/lib/run-ops/approval.ts:85-126`; `packages/api/src/lib/reconcile-stale-approval.ts`; `packages/dashboard/src/lib/approval-recovery.ts`.
- **Maturity:** live-peripheral
- **Quality:** adequate — guarded by `reviewGateSatisfied` and branch/commit presence, transactional restore with audit; covered by reconcile-stale-approval.test.ts and approval-stale.routes.test.ts. `RECOVERABLE_STALLED_APPROVAL_REASONS` is duplicated verbatim in approval.ts and reconcile-stale-approval.ts.
- **Operator-legibility risk:** partial — recovery depends on the operator (or reconcile) understanding `failReason` codes like `stale_slot_gc`; the dashboard helper softens this but the underlying state is raw.
- **Dependencies:** `ORPHANED_*` reasons from `@ductum/core`, run repos, merge path.
- **Disposition (recommended):** KEEP — small, tested safety valve; consider de-duplicating the recoverable-reasons set.
- **Flags:** minor — duplicated `RECOVERABLE_STALLED_APPROVAL_REASONS` constant in two files (approval.ts:22-26 and reconcile-stale-approval.ts:13-17).

## Approval auto-rebase on stale branch (one-click)
- **What:** When approval hits a stale-branch gate, `--rebase` rebases the worktree onto base, re-runs verify, re-links the commit, and re-merges; on conflict it dispatches a fix-rebase task.
- **Where:** `packages/api/src/lib/run-ops/approval-rebase.ts` (D122); route `packages/api/src/routes/runs.ts:444`; dashboard via `useApproveRun`/recovery UX.
- **Maturity:** live-peripheral
- **Quality:** adequate — well-documented intent, leans on existing `@ductum/core` rebase/verify helpers; this is adjacent to the Telegram path (Telegram's `handleAction` calls plain `approveRun`, not the rebase variant).
- **Operator-legibility risk:** partial — operator must choose `--rebase` in response to a failure reason; the dashboard recovery banner mitigates.
- **Dependencies:** `rebaseWorktreeOntoBase`, `verifyWorktree`, `mergeApprovedRun`, fix-task dispatch.
- **Disposition (recommended):** KEEP — useful operator ergonomics, tied to the same approval domain.
- **Flags:** note — the Telegram approve button does NOT offer rebase recovery; a Telegram approve on a stale branch will fail back to dashboard/CLI. Acceptable but worth knowing.

## Legacy / dead-but-not-deleted in this domain
- `DUCTUM_TELEGRAM_CONFIG` env-based config (`source: 'legacy'`): live parallel path to resource-backed channels — `packages/api/src/lib/telegram.ts:31-68`, wired at `packages/api/src/lib/deps.ts:268`, branch at `telegram-runtime.ts:66`. Candidate for removal once channels are resource-only.
- Retired "resource" vocabulary throughout the channel layer: `notification-channels.ts` and `telegram-runtime.ts` operate on `ConfigResource`; CRUD is via `/api/resources/NotificationChannel` and `context.repos.configResources` — the surface the operational-model redesign retired from normal use.
- D055 unbuilt backends: `webhook`, `local`, Slack, email backends specified in `decisions/055-notification-backends.md` were never implemented; only `telegram` exists. The `NotificationBackend` interface and the broad message/action taxonomy are aspirational stubs.
- Stale generated `notificationChannelRef` on agents: appears only in `packages/cli/dist/init/scaffolders/factory-yaml.js` (default `'stdout'`) and has NO source `.ts` definition or any consumer in api/core — dead generated artifact pointing at a non-existent channel.
- Grandfathered oversize files in this domain (`decisions/112-file-size-grandfather-list.md`): `packages/dashboard/src/components/approval/ApprovalCard.tsx` (372 LOC), `packages/api/src/tests/notification-channel-runtime.test.ts` (347 LOC), `packages/cli/src/tests/telegram-command.test.ts` (326 LOC) — not dead, but flagged for later split.
- Duplicated `RECOVERABLE_STALLED_APPROVAL_REASONS` constant in `run-ops/approval.ts` and `reconcile-stale-approval.ts`.
