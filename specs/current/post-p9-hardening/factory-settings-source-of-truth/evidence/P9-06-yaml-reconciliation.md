# P9 Evidence 06 — YAML / settings-config Reconciliation

```bash
rg -n "settings/config|settings-yaml|yamlPatch|ductum\.yaml" \
  packages/api packages/cli packages/dashboard/src docs \
  specs/current/post-p9-hardening/factory-settings-source-of-truth README.md
```

## Classification of every hit

| Location | Hits | Class | Verdict |
|---|---|---|---|
| `packages/api` | **0** | — | clean |
| `packages/cli/src/init/paths.ts:79,107` | 2 | legacy rejection guard — init refuses a dir that contains legacy `ductum.yaml` state | OK |
| `packages/cli/src/tests/**` (init/command, init/scaffold, init/tui, cli-cutover-command, serve-command) | 5 | negative guards (`expect(...ductum.yaml...)).toBe(false)` / `not.toContain`) | OK |
| `packages/dashboard/src/tests/**` (settings, p7b-ia) | 5 | negative guards: `settings-yaml` testId absent, `/api/settings/config` never fetched | OK |
| `README.md:15`, `docs/SETUP.md:106`, `docs/SELF_HOST_MAC_MINI.md:31` | 3 | negative statements ("there is no `ductum.yaml`") | OK |
| `docs/onboarding/evidence-clean-container-smoke.md` | 4 | dated historical evidence from a pre-cutover arc | OK (historical) |
| `docs/analysis/2026-04-*.md` | 3 | dated historical analysis docs | OK (historical) |
| `specs/current/post-p9-hardening/factory-settings-source-of-truth/**` | rest | the spec/audit/stage prompts that define this removal work | OK (spec subject matter) |

No normal runtime, UI, API, or CLI dependency on `/api/settings/config`,
`settings-yaml`, `yamlPatch`, or `ductum.yaml` remains. Live confirmation:
`GET /api/settings/config` on the fresh factory returns 404 (P9-01).

PASS.
