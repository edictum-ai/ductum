/**
 * Activity content size limits — shared across harness adapters.
 *
 * The dashboard renders tool-call args, tool results, assistant text,
 * and session-end messages from the run_activity table. Originally
 * each adapter hard-coded its own slice limits (120, 200, 500, 2000)
 * and operators kept seeing content cut off in the UI. Now all
 * adapters funnel content through this single helper so the limit
 * is consistent and configurable.
 *
 * Resolution order for the cap:
 *
 *   1. `DUCTUM_ACTIVITY_MAX_BYTES` env var (integer).
 *   2. Fallback constant (64 KB — enough for basically every tool
 *      call, assistant response, or tool result we've seen in
 *      production).
 *
 * When content exceeds the cap we append a human-readable marker so
 * the dashboard can show "X chars dropped" instead of pretending the
 * content is complete. Marker format: `\n[…N chars truncated]`.
 *
 * Why a single env var instead of per-kind limits: operators who
 * want to constrain DB growth can set it once and get predictable
 * behavior everywhere. The default (64 KB) × ~100 activities per
 * run × 50 runs/day = ~320 MB/day max, and in practice most
 * activities are a few hundred bytes so actual growth is tiny.
 */

const DEFAULT_ACTIVITY_MAX_BYTES = 64 * 1024

/**
 * Resolved activity cap in bytes. Read lazily so test harnesses can
 * set `process.env.DUCTUM_ACTIVITY_MAX_BYTES` before importing this
 * module.
 */
export function getActivityMaxBytes(): number {
  const raw = process.env.DUCTUM_ACTIVITY_MAX_BYTES
  if (raw == null || raw === '') return DEFAULT_ACTIVITY_MAX_BYTES
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ACTIVITY_MAX_BYTES
  return Math.floor(parsed)
}

/**
 * Truncate `content` to the resolved cap, appending a marker when
 * content was dropped. Safe to call on any string — content within
 * the cap is returned unchanged.
 *
 * The marker takes space from the budget (i.e. when the cap is 100
 * and content is 500 chars, we keep the first `100 - marker.length`
 * chars and append the marker). This guarantees the returned string
 * is always ≤ cap.
 */
export function truncateActivity(content: string): string {
  const cap = getActivityMaxBytes()
  if (content.length <= cap) return content
  const marker = `\n[… ${(content.length - cap).toLocaleString()} chars truncated]`
  // Reserve marker.length bytes from the budget so the final string
  // is ≤ cap. Minimum 16 chars of actual content regardless.
  const keep = Math.max(16, cap - marker.length)
  return content.slice(0, keep) + marker
}
