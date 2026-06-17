export const D135_CORE_STREAM_EVENT_KINDS = [
  'run.dispatched',
  'run.stage_changed',
  'run.awaiting_approval',
  'run.cancelled',
  'run.failed',
  'run.completed',
  'cost_budget.paused',
  'cost_budget.extended',
  'slot.auto_closed',
  'factory.events_stream_resumed',
] as const

export const D135_INIT_STREAM_EVENT_KINDS = [
  'init.started',
  'init.directory_resolved',
  'init.auth_started',
  'init.auth_detected_existing',
  'init.auth_pkce_url_emitted',
  'init.auth_completed',
  'init.auth_failed',
  'init.auth_codex_started',
  'init.auth_codex_completed',
  'init.auth_codex_skipped',
  'init.auth_codex_failed',
  'init.auth_copilot_started',
  'init.auth_copilot_completed',
  'init.auth_copilot_skipped',
  'init.auth_copilot_failed',
  'init.agents_selected',
  'init.scaffolded',
  'init.operator_token_created',
  'init.api_starting',
  'init.api_ready',
  'init.api_seeded',
  'init.handoff_created',
  'init.browser_opened',
  'init.browser_skipped',
  'init.completed',
  'init.cancelled',
] as const

export const D135_STREAM_EVENT_KINDS = [
  ...D135_CORE_STREAM_EVENT_KINDS,
  ...D135_INIT_STREAM_EVENT_KINDS,
] as const

export type D135StreamEventKind = typeof D135_STREAM_EVENT_KINDS[number]
