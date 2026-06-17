# P9 Evidence 04 — Model Catalog Proof

No catalog refresh was run in P9; this only verifies the P8-refreshed catalog
is what a fresh DB-only init seeds and what the typed APIs serve.

## Typed catalog (`GET /api/factory/models`)

32 models seeded at init, served from DB (`source: "saved"`). The
P8-refreshed entries are all present:

- `gpt-5.3-codex-spark` (research-preview, unmeasured pricing)
- `gpt-5.5-pro`, `gpt-5.4-pro` (API-priced, no supported Ductum harness)
- `o3-mini` (still API-available)
- Z.AI GLM Coding Plan set: `glm-5.1`, `glm-5-turbo`, `glm-4.7`, `glm-4.5-air`
- `glm-5v-turbo` (and no standalone `glm-5v` — matches official Z.AI docs)
- No Claude Mythos 5 (limited availability — correctly excluded)
- Anthropic set includes `claude-fable-5`, `claude-opus-4-8`, etc.

The dashboard Settings model picker renders from this same typed catalog
(`packages/dashboard/src/settings/ModelPicker.tsx`, P7), covered by the
dashboard test suite (23 files / 139 tests green in this session's run).

## Unsupported pair rejection (typed agent path)

`POST /api/agents`:

| Input | Result |
|---|---|
| `{modelRef:"glm-5.1", harnessRef:"codex-sdk"}` | 400 — `Agent bad-pair-agent Ductum model ID glm-5.1 with provider model ID glm-5.1 is not supported by Harness adapter type codex-sdk` |
| `{modelRef:"gpt-5.5-pro", harnessRef:"codex-sdk"}` | 400 — same shape; `gpt-5.5-pro` has no supported harness, catalog-visible only |
| positive control `{modelRef:"glm-5.1", harnessRef:"claude-agent-sdk"}` | 201 — valid per the P8 Z.AI GLM Coding Plan mapping |

Errors name the exact identity types (Ductum model ID, provider model ID,
Harness adapter type) per the P2-seam contract.

PASS.

## Known issue (pre-existing, not a P9 blocker)

`GET /api/factory/workflows` returns two `coding-guard` rows: one derived
`source: "built-in"` preset and one `source: "saved"` DB row seeded by init,
same name and path. They are distinguishable by `source`, but the Settings
Workflows panel shows "coding-guard" twice. First observed in the P6 live
test (2026-06-11); still present on fresh init. Belongs to the
post-source-of-truth backlog (init seeding or catalog de-dup), not P9.
