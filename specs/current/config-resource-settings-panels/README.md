# Config Resource Settings Panels

## Intake

Make existing declarative config resources editable through structured Settings
controls. Runtime resource backing is in place, but operators still have to use
raw YAML to edit most resource sections. This slice should make the common
resource fields visible and editable without creating a marketplace or changing
runtime behavior.

## Grill Questions

- Is this a new runtime slice? No. Runtime behavior is unchanged; this is an
  operator settings surface for existing resource sections.
- Should this build provider pickers or a marketplace? No. Use simple fields for
  the already supported schema.
- How are invalid resources handled? The existing settings validation remains
  authoritative and must surface errors in the current save/validate path.
- How far should NotificationChannel go? Only the existing Telegram-backed
  shape. No broad notification provider UI.
- What happens to secrets? Do not invent secret management. Existing secret
  handling remains; unknown or sensitive values can stay in YAML.

## Decisions

- Add decision `086` for config resource settings panels.
- Keep the existing settings YAML document as the source.
- Add structured panels for `models`, `harnesses`, `sandboxProfiles`,
  `workflowProfiles`, and `notificationChannels`.
- Extend YAML patching only for fields the current settings validator accepts.
- Preserve raw YAML as the escape hatch for unsupported or advanced fields.

## Decision Trace

- Decisions: `053`, `055`, `056`, `057`, `058`, `059`, `060`, `064`, `066`,
  `079`, `080`, `081`, `082`, `083`, `084`, `085`, `086`.
- Non-goals: no new resource kind; no new top-level primitive/table; no
  marketplace or plugin UI; no runtime behavior change; no Edictum or policy
  change; no broad dashboard redesign; no new dependency.
- Allowed scope: dashboard settings panels, settings types, YAML patch support
  for current resource fields, targeted dashboard/API tests, dogfood records,
  and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/config-resource-settings-panels --path`,
  `ductum spec drift-review ductum config-resource-settings-panels`, package
  tests, build, `git diff --check`, and Claude adversarial slop review.
- Drift handling: record a decision before adding a resource kind, provider
  marketplace, plugin abstraction, runtime behavior, dependency, table, or
  policy behavior.

## Behavior Contract

- Settings resource YAML must be preserved when rendering controls for existing `models`, `harnesses`, `sandboxProfiles`, `workflowProfiles`, and `notificationChannels` sections.
- Editing Model resource provider, model id, access ref, or supported efforts must preserve YAML comments and avoid full-document rewrites for common cases.
- Editing Harness resource type, command, control mode, or supported sandboxes must preserve YAML comments and avoid fake adapter marketplace UI.
- Editing SandboxProfile resource provider or mode must preserve YAML comments and must not claim network, credential, resource, or process enforcement.
- Editing a WorkflowProfile path or description must preserve YAML comments.
- Editing NotificationChannel backend and Telegram config enabled state must preserve YAML comments, keep skip/send state visible, and avoid new provider branches.
- Adding a resource through the structured panel must create valid minimal YAML, and invalid generated YAML must fail through the existing settings API validation path.
- Invalid resource edits must fail through the existing server validation path
  and must be visible in Settings, not swallowed.
- Malformed Model, Harness, SandboxProfile, WorkflowProfile, or NotificationChannel resources must be rejected by the existing API validation path and leave persisted YAML unchanged.
- A failed save must surface the API error in operator-visible Settings output, not logs only.
- Unsupported advanced resource fields must preserve raw YAML editability and must not be silently dropped during structured saves.
- The implementation must not add a new top-level primitive/table, runtime
  behavior, provider marketplace, plugin system, second policy system, or
  dependency.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did structured resource edits preserve comments?
- Did the implementation avoid fake provider/marketplace branches?
- Did it avoid claiming unsupported sandbox enforcement?
- Did server validation remain the loud failure path?
- Did raw YAML remain the escape hatch for advanced fields?
- Did it avoid duplicating resource normalization logic from the API?
- Did it avoid runtime behavior changes?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-CONFIG-RESOURCE-SETTINGS-PANELS.md](P1-CONFIG-RESOURCE-SETTINGS-PANELS.md) | dashboard/api | Structured resource settings panels, YAML patching, behavior tests, dogfood | [x] | - |

## Dogfood Record

- Spec imported as `RIv5OyFVLnWp`.
- Task imported as `fmQLXF5FFr4M`.
- Implementation run accepted as `3xjgpi5tlSj_`.
- Decision record: `6ZgJe4t7Yk3U`.
- Spec audit evidence: `dCsgWoydjrtz`.
- Verification evidence: `CruyfXNiQetk`.
- Final verification evidence after local slop fixes: `ISUk5U6wLZT2`.
- Review evidence: `ht8dQgKFVhqh` (`claude -p` hung without stdout after
  repeated attempts; local slop review tightened behavioral coverage).

## Verification

```sh
ductum spec contract-check ductum specs/current/config-resource-settings-panels --path
ductum spec drift-review ductum config-resource-settings-panels
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test
pnpm build
git diff --check
```

Status: implemented and verified; external Claude reviewer unavailable in this
session, with failed review attempts recorded as evidence.
