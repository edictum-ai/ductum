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
- `awaiting_approval`
- `failed`
- `stalled`
- `cancelled`
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

## Frontend Rule
Use `packages/dashboard/src/lib/run-presentation.ts` for status, cost, and run links.

Do not call `deriveDisplayStatus`, `formatCost(run.costUsd)`, or hand-built run URLs directly in new UI code unless the component is explicitly a low-level fallback helper.
