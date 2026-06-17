# P2 - Dashboard Truthfulness (dogfood)

## Problem

The 2026-04-30 chrome-devtools audit produced screenshots in
`/tmp/ductum-ui-audit/` documenting:

- D5 home page slow / "Loading view…" flash on reload
- D6 approvals page conflates imported decision traces with operator decisions
- D7 resource panels (Models, Harnesses, SandboxProfile, WorkflowProfile)
  are full of plain text inputs where the system has small enums
- D8 Create Task dialog shows 94 unfiltered, ungrouped, unsearchable
  dependency checkboxes
- D9 NotificationChannel section is empty with no template / wizard
- D11 Glm shows up in Agent cards even after removal from project pool
- D12 Harness combobox is hardcoded, not driven by registered Harness
  resources

## Scope

Dispatched through Ductum. Each behavior contract bullet is one task.

## Behavior Contract

| Task | Scope |
|------|-------|
| `dashboard-resource-form-pickers` | Replace text inputs in `ConfigResourcesPanel.tsx` (Models, Harnesses, SandboxProfile, WorkflowProfile) with the existing `*Picker` / combobox / chip patterns from `AgentConfigPanel.tsx`. Choices come from registered resources, not hardcoded lists. |
| `dashboard-spec-import-button` | Specs page gains an "Import spec" entry point that calls existing `/api/specs/import`. Accepts directory path or yaml manifest. |
| `dashboard-task-dependency-picker` | Create Task dialog dependency list gains search + grouping by status. |
| `dashboard-harness-source-of-truth` | Agent harness combobox lists registered Harness resources, not a hardcoded enum. Resource panel + agent picker drive from the same data. |
| `dashboard-decisions-vs-imports-split` | Approvals page separates operator decisions from imported decision traces visually and in the "Your recent decisions" section. |
| `dashboard-glm-stale-card-cleanup` | Agent card filters by current project pool, not global agent catalog. |
| `dashboard-home-load-skeleton` | Render skeleton during initial load instead of "Loading view…" flash. |

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
git diff --check
```

Plus chrome-devtools walkthrough re-runs each defect:
- D1 banner appears on 401, not on success.
- D3 spec list renders correct status (already P0).
- D4 `/runs/<id>` works (already P0).
- D5 home page renders skeleton, not `Loading view…`.
- D6 imported decision traces are visually distinct from operator decisions.
- D7 every resource form field is a picker / combobox / chip group.
- D8 Create Task dialog supports search + grouping.
- D9 NotificationChannel "Add Telegram channel" wizard ties to Telegram settings.
- D11 Removed agents disappear from Agent cards.
- D12 Harness combobox source is registered Harness resources.

## Exit Demo

I open the dashboard from a fresh `pnpm serve`, click through every page
and form, and the chrome-devtools audit produces zero new defect screenshots.

## Slop Review

- Attack any task that ships outside Ductum dispatch.
- Attack any picker that hardcodes options instead of reading them from
  registered resources.
- Attack any cleanup that hides defunct data instead of filtering by
  current project pool.
