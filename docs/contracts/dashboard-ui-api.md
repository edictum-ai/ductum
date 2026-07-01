# Dashboard UI API Contract

## Status
Accepted

## Rule
The dashboard must consume backend UI fields for user-facing status, tone, cost, and links when those fields are present.

Frontend code may use local derivation only as a compatibility fallback for old responses or tests. It must not create page-specific meanings for the same run state.

## Run DTO
Enriched run responses from `GET /api/runs` and `GET /api/projects/:id/runs` include:

```json
{
  "ui": {
    "schemaVersion": "ductum.ui.run.v1",
    "status": {
      "key": "done",
      "label": "Done",
      "tone": "ok",
      "terminal": true,
      "needsAttention": false
    },
    "cost": {
      "usd": 0,
      "label": "missing usage",
      "state": "unmeasured"
    },
    "href": "/qratum/milestone-a/P0-REPO-SKELETON-CLEANUP/abc123"
  }
}
```

## Status Vocabulary
Allowed status keys:

- `running`
- `awaiting_review`
- `awaiting_approval`
- `failed`
- `stalled`
- `cancelled`
- `paused`
- `frozen`
- `quarantined`
- `done`

Allowed tones:

- `ok`
- `warn`
- `err`
- `info`
- `accent`
- `mid`

## Cost Vocabulary
Allowed cost states:

- `measured`: token usage or cost was recorded.
- `pending`: the run is active and cost is not known yet.
- `unpriced`: token usage was recorded but the model has no trusted price.
- `unmeasured`: the run finished without token or cost telemetry.

The UI must show `missing usage` instead of `$0.00` when a finished run has no
token telemetry, and `missing price` when usage is known but pricing is missing.
Rollups should not collapse these states into one label: show tracked spend,
missing usage, missing price, and pending counts separately.

## Activity Aggregates
Factory-level headline counts and cost totals must consume
`GET /api/factory/activity-summary`.

That response is server-computed over all run rows in the factory database and
labels its source as uncapped. Home, Factory Activity, and the sidebar spend
pulse may still fetch capped row lists for feeds, search, and recent activity,
but they must not derive factory-wide spend, clean-done, missing-usage, or
status totals from those capped lists when the aggregate is available.

## Frontend Rule
Use `packages/dashboard/src/lib/run-presentation.ts` for status, cost, and run links.

Do not call `deriveDisplayStatus`, `formatCost(run.costUsd)`, or hand-built run URLs directly in new UI code unless the component is explicitly a low-level fallback helper.

## Actionability Rules
Home is a summary surface. It should show compact current action items and link to the attempt detail or Factory Activity. It must not dump full retry-risk blocks, worktree paths, or command snippets on the first viewport.

Home should not show non-actionable historical feeds such as imported decision
trace lists. Decision records belong on the related spec, run, or approval
surface where the operator can see their context.

Factory Activity is the detailed recovery surface. It should link to the
attempt detail, show retry risk, and make attempt IDs easy to copy. Do not show
local CLI snippets as primary recovery steps unless that command path is
verified in the operator environment. Retry guidance must use the shared
recoverability rule. A failed or stalled attempt with `recoverable: false` is
not retryable; show inspection/repair/fresh-work guidance instead.

Run Detail controls must render only actions that can actually be taken. If no mutation is available, show a read-only no-actions line and do not show a reason input, disabled approval buttons, or redirect forms.

Project Detail must not expose full or partial `[redacted]` text as a primary
visible label or summary. Keep raw spec and task names for routing, but display
a source issue label, useful title, or short-id fallback when the stored name or
brief text is redacted.

Search and command-palette results follow the same rule. If a stored spec or
task name is redacted, public search output must use a display fallback and an
ID-backed dashboard route that `GET /api/resolve` can resolve.

## Loading Semantics
Operator-facing counts must not treat unresolved queries as zero. Project cards, Project Detail scope counts, and attempt-derived metrics should render loading/skeleton states until their dependent specs, tasks, repositories, agents, and run-history queries have resolved at least once.

Home loading must show a visible local-session state with a `ductum start` fallback so a clean browser load is not a blank shell.

## Structured Summaries
Completion summaries whose JSON payload has `kind: "ductum-review-result"` must render as review verdict cards, not raw JSON. The hero may show a short verdict summary, but the findings belong in the structured card.
