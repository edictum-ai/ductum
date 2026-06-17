# P1 - Config Resource Settings Panels

## Scope

Add structured Settings controls for the existing config resource sections so
operators can edit common Model, Harness, SandboxProfile, WorkflowProfile, and
NotificationChannel fields without dropping to raw YAML for every change.

Runtime behavior is out of scope. Existing settings YAML remains the source of
truth, and existing API validation remains authoritative.

## Decision Trace

- Decisions: `053`, `055`, `056`, `057`, `058`, `059`, `060`, `064`, `066`,
  `079`, `080`, `081`, `082`, `083`, `084`, `085`, `086`.
- Non-goals: no new resource kind; no new top-level primitive/table; no
  marketplace or plugin UI; no runtime behavior change; no Edictum or policy
  behavior change; no broad dashboard redesign; no new dependency.
- Allowed scope: dashboard Settings panels, settings types, YAML patch support
  for current resource fields, targeted dashboard/API tests, dogfood records,
  and review artifacts.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
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

## Implementation Notes

- Add compact resource panels under the existing Settings page rather than a new
  dashboard area.
- Keep provider inputs literal for current schemas. Do not add future provider
  branches or discovery behavior.
- Extend YAML patch support only for accepted common fields:
  `provider`, `modelId`, `accessRef`, `supportedEfforts`, `type`, `command`,
  `controlMode`, `supportedSandboxes`, `path`, `description`, `backend`, and
  Telegram `config.enabled`.
- For adding resources, generate minimal valid YAML for each existing resource
  kind.
- Leave unsupported nested fields such as sandbox filesystem/network details
  editable through raw YAML.
- Reuse existing Settings save/validate flow so server validation remains the
  loud failure path.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did structured resource edits preserve comments?
- Did the implementation avoid fake provider/marketplace branches?
- Did it avoid claiming unsupported sandbox enforcement?
- Did server validation remain the loud failure path?
- Did raw YAML remain the escape hatch for advanced fields?
- Did it avoid duplicating resource normalization logic from the API?
- Did it avoid runtime behavior changes?

## Verification

```sh
ductum spec contract-check ductum specs/current/config-resource-settings-panels --path
ductum spec drift-review ductum config-resource-settings-panels
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test
pnpm build
git diff --check
```
