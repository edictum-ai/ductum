# Bootstrap-Redesign Arc — Codex Audit Confirmation

**Authored:** 2026-05-05 by Codex, against `ductum@0.1.1`.

**Environment:** fresh Docker `node:22` container with `HOME=/tmp/audit-home`,
`npm install -g ductum@0.1.1`, no initial auth dirs or provider env vars. The
Claude OAuth browser flow was blocked by Cloudflare Turnstile in this container,
so downstream agent-execution tests used a copied Claude credentials file whose
tokens were refreshed inside the container. That distinction matters: PKCE URL
emission was tested, but a clean end-to-end Claude consent click was not.

Evidence lives in `specs/current/bootstrap-redesign/evidence/audit-codex/`.
## Section 1.1 — `pnpm install -g ductum@0.1.1`
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `02-pnpm-install.txt`
- **Notes:** Plain pnpm install skipped the `better-sqlite3` build; `--allow-build=better-sqlite3` built the native binding.
## Section 1.2 — `npm install -g ductum@0.1.1`
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `01-npm-install.txt`
- **Notes:** `ductum --version` returned `0.1.1`; `claude` was not on PATH.
## Section 1.3 — Tarball contents
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `46-npm-pack-contents.json`
- **Notes:** Tarball contains `dist`, `assets/specs/examples/hello-readme`, README, and LICENSE.
## Section 2.1 — Welcome screen renders
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `43-tui-codex-acquisition.txt`, `44-tui-copilot-acquisition.txt`
- **Notes:** Fresh TUI renders the welcome note and Enter gate.
## Section 2.2 — Directory prompt
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `05-init-result.txt`
- **Notes:** Default install produced `/tmp/audit-home/ductum/factory`.
## Section 2.3 — Project name prompt
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `05-init-result.txt`, `49-factory-config-files.txt`
- **Notes:** Default project name was `factory` in the scaffolded YAML.
## Section 2.4 — Confirm scaffold
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `43-tui-codex-acquisition.txt`
- **Notes:** Confirm default is `No`; selecting `Yes` proceeds.
## Section 2.5 — Anthropic auth (PKCE)
- **Claude's verdict:** `works`
- **Codex's verdict:** DISPUTED — `partial`
- **Evidence:** `oauth-snapshot.txt`, `54-enter-during-pkce.txt`
- **Notes:** PKCE URL emission and local wait state work. I could not independently complete consent because `claude.ai` served Cloudflare Turnstile to the audit browser.
## Section 2.6 — Codex auth — skip path
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `44-tui-copilot-acquisition.txt`
- **Notes:** Default `No` skips and prints `Run codex login later`.
## Section 2.7 — Codex auth — acquisition path
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `43-tui-codex-acquisition.txt`
- **Notes:** The Yes path is reachable and fails cleanly when the Codex CLI is absent, with suggested `codex login`. Full account acquisition was not tested.
## Section 2.8 — Copilot auth — skip path
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `44-tui-copilot-acquisition.txt`
- **Notes:** Default `No` skips and prints the expected message.
## Section 2.9 — Copilot auth — acquisition path
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `44-tui-copilot-acquisition.txt`
- **Notes:** The Yes path is reachable and fails cleanly when `gh` is absent, with suggested `gh auth login`. Full GitHub device flow was not tested.
## Section 2.10 — Agent picker
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `49-factory-config-files.txt`
- **Notes:** The completed scaffold selected `claude-builder`.
## Section 2.11 — Scaffold step
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `05-init-result.txt`, `49-factory-config-files.txt`
- **Notes:** Files and initial git metadata were created.
## Section 2.12 — API start
- **Claude's verdict:** `works (post-D159)`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `05-init-result.txt`, `06-health-49050.txt`, `07-proxied-health.txt`
- **Notes:** API started on an OS-assigned loopback port. Docker required a proxy to expose it to the host browser.
## Section 2.13 — Dashboard URL surfaced
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `05-init-result.txt`, `01-welcome-token-undefined.png`
- **Notes:** TUI printed `/welcome?token=undefined`.
## Section 3.1 — Re-running init in an existing factory dir
- **Claude's verdict:** `works (per tests)`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `53-init-existing-dir.txt`
- **Notes:** Live `0.1.1` returns structured `init_already_initialized` with `ductum start --dir ...`.
## Section 3.2 — Cancelling at each prompt with Ctrl+C
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `45-sigint-mid-scaffold.txt`, `03-init-pkce-cancel.txt`
- **Notes:** Installed `0.1.1` rolls back a new project dir when SIGINT lands during a delayed `git commit`. I did not exhaustively cancel every prompt.
## Section 3.3 — PKCE callback timeout
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `packages/cli/src/tests/init/auth-anthropic.test.ts`
- **Notes:** Not re-run live because the timeout would be slow and OAuth was browser-blocked; the regression exists in source tests.
## Section 3.4 — PKCE callback port collision
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `packages/cli/src/tests/init/auth-anthropic.test.ts`
- **Notes:** Source test coverage exists; not re-run live.
## Section 3.5 — Invalid project name
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `packages/cli/src/tests/init/paths.test.ts`
- **Notes:** Source test coverage exists; not re-run live.
## Section 3.6 — Unwritable directory
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `packages/cli/src/tests/init/paths.test.ts`
- **Notes:** Source test coverage exists; not re-run live.
## Section 3.7 — Existing git repo with uncommitted changes
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `packages/cli/src/tests/init/paths.test.ts`
- **Notes:** Source test coverage exists; not re-run live.
## Section 3.8 — Live regression observation: Enter during PKCE wait
- **Claude's verdict:** `broken`
- **Codex's verdict:** DISPUTED — `works`
- **Evidence:** `54-enter-during-pkce.txt`
- **Notes:** Pressing Enter during the PKCE spinner did not fail auth in my clean run. It kept waiting until I sent Ctrl+C.
## Section 4.1 — Route loads with valid handoff token
- **Claude's verdict:** `partial`
- **Codex's verdict:** DISPUTED — `works`
- **Evidence:** `02-welcome-valid-handoff-banner.png`, `51-valid-handoff-fetch-log.json`
- **Notes:** A fresh handoff loaded and URL-stripped. I saw one `POST /api/internal/welcome/exchange` with status 200, not a second exchange or 410.
## Section 4.2 — Route handles `?token=undefined`
- **Claude's verdict:** `broken`
- **Codex's verdict:** EXPANDED — `broken`
- **Evidence:** `01-welcome-token-undefined.png`
- **Notes:** The route is broken for init's URL, but it does show a clear `Welcome link expired` message, not just a half-loaded dashboard.
## Section 4.3 — Token-to-cookie exchange + URL strip
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `51-valid-handoff-fetch-log.json`, `02-welcome-valid-snapshot.txt`
- **Notes:** Exchange and URL strip work. Earlier handoff-path render still showed the operator-token banner and SSE 401 before auto-detect, so the auth UX remains partial.
## Section 4.4 — "Import your first spec" UI (file upload)
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `works`
- **Evidence:** `03-welcome-file-upload-preview.png`
- **Notes:** File input, preview, and import result worked for a YAML smoke spec.
## Section 4.5 — "Create Sample" / sample task button
- **Claude's verdict:** `partial`
- **Codex's verdict:** DISPUTED — `works`
- **Evidence:** `04-welcome-sample-created-banner-offline.png`, `08-queue-after-imports.json`
- **Notes:** Clean run showed visible success text. The running dispatcher later auto-dispatched ready tasks, which is a separate lifecycle issue.
## Section 4.6 — SSE event stream rendering
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `05-factory-live-run-connected.png`, `06-run-detail-live-sse.png`, `18-cli-status-cancel-events.txt`
- **Notes:** SSE rendered during an env-token-backed real run after auto-detect auth. The raw handoff path still showed auth/banner trouble.
## Section 5.1 — Add new agent
- **Claude's verdict:** `broken`
- **Codex's verdict:** EXPANDED — `broken`
- **Evidence:** `20-agents-add-agent.png`, `21-agents-save-roundtrip-snapshot.txt`
- **Notes:** Add defaults to Codex SDK. Saving after add fails with `Agent 0 sandboxRef not found: worktree-default`.
## Section 5.2 — Agent name is not editable in UI
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `19-agents-snapshot.txt`
- **Notes:** The existing agent editor has static `AGENT 0` text and no rename input.
## Section 5.3 — First agent literally named "0"
- **Claude's verdict:** `broken`
- **Codex's verdict:** EXPANDED — `broken`
- **Evidence:** `19-agents-snapshot.txt`, `49-factory-config-files.txt`
- **Notes:** In clean state, YAML still names `claude-builder`, but the editor labels the first resource as `0`. This is not just Claude's contaminated Lima data.
## Section 5.4 — Phantom "0" harness in picker
- **Claude's verdict:** `broken`
- **Codex's verdict:** EXPANDED — `broken`
- **Evidence:** `20-agents-add-agent.png`, `23-settings-snapshot.txt`
- **Notes:** `0` appears in harness picker/config resources in the clean run.
## Section 5.5 — Workforce count ≠ config count
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `19-agents-snapshot.txt`
- **Notes:** Workforce shows `claude-builder`; editor shows `AGENT 0`.
## Section 5.6 — Model picker
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `20-agents-add-agent.png`
- **Notes:** Model selection surface is present; I did not find a worse issue than Claude's defaulting complaint.
## Section 5.7 — Harness picker
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `20-agents-add-agent.png`, `23-settings-snapshot.txt`
- **Notes:** Functional native select, polluted by phantom `0`.
## Section 5.8 — Effort picker
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `20-agents-add-agent.png`
- **Notes:** Effort combobox renders and has expected options.
## Section 5.9 — Capabilities picker
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `20-agents-add-agent.png`
- **Notes:** Capability toggles render.
## Section 5.10 — Routing tier
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `20-agents-add-agent.png`
- **Notes:** Routing tier input renders.
## Section 5.11 — Save agents button
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `broken`
- **Evidence:** `21-agents-save-roundtrip-snapshot.txt`, `22-agents-after-reload-snapshot.txt`
- **Notes:** No-op save reports `SAVED WITH WARNINGS`; save after add fails with `Agent 0 sandboxRef not found`, and the added agent is gone after reload.
## Section 5.12 — Edit existing agent
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `19-agents-snapshot.txt`, `21-agents-save-roundtrip-snapshot.txt`
- **Notes:** Field editing exists, rename is absent, and save can fail because default resource refs are invalid.
## Section 5.13 — Delete agent
- **Claude's verdict:** `not-shipped`
- **Codex's verdict:** CONFIRMED — `not-shipped`
- **Evidence:** `19-agents-snapshot.txt`
- **Notes:** No delete affordance visible.
## Section 6.1 — Add project
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `33-cli-project-multiproject.json`, `35-home-multiproject.png`
- **Notes:** CLI `project create` works. Dashboard has no visible add-project or project-list surface; direct `/second` works if the user knows the URL.
## Section 6.2 — Project detail rendering
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `34-project-second.png`, `39-project-second-after-import.png`
- **Notes:** Direct project detail route renders.
## Section 6.3 — Project assignments to agents
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `40-cli-project-assign.json`, `41-project-second-assignment-snapshot.txt`
- **Notes:** CLI assignment works and dashboard displays assigned agent. I found no dashboard assignment UI.
## Section 7.1 — Spec list rendering
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `25-specs-page.png`, `26-specs-needs-attention.png`
- **Notes:** The default Current tab hides failed specs; Needs attention shows them.
## Section 7.2 — Importing a spec via dialog
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `works`
- **Evidence:** `03-welcome-file-upload-preview.png`
- **Notes:** Dialog upload/import path worked.
## Section 7.3 — Editing a spec
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `unimplemented`
- **Evidence:** `27-spec-detail.png`, `28-spec-new-task-dialog.png`
- **Notes:** Spec detail shows document text, New Task, Open project, Delete spec. I found no edit affordance for the spec document.
## Section 7.4 — Setting spec status
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `27-spec-detail-snapshot.txt`
- **Notes:** Status renders, but I found no direct status editor.
## Section 7.5 — Spec list filter behavior
- **Claude's verdict:** `broken (default)`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `25-specs-snapshot.txt`, `26-specs-needs-attention.png`
- **Notes:** Default Current filter shows `No specs match this filter` while failed specs exist.
## Section 8.1 — "Operator token required" banner
- **Claude's verdict:** `broken`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `02-welcome-valid-handoff-banner.png`, `23-settings-page.png`
- **Notes:** Banner persists on one handoff path, but authenticated auto-detect pages show `connected` without the banner. Not globally broken in the clean run.
## Section 8.2 — Factory `name` field
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Field renders as `factory`; save behavior not deeply exercised.
## Section 8.3 — Factory `merge mode` field
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `23-settings-snapshot.txt`, `33-cli-project-multiproject.json`
- **Notes:** Settings shows factory-level `human`; project API config defaults `auto`.
## Section 8.4 — Factory `heartbeat seconds` field
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Field is empty in fresh scaffold.
## Section 8.5 — Factory `API port` field
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Field is empty despite the API running on `49051`.
## Section 8.6 — Factory `dashboard port` field
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `23-settings-snapshot.txt`, `47-cli-doctor.json`
- **Notes:** Field is empty; doctor reports stale dashboard URL `http://localhost:5176`.
## Section 8.7 — Factory `merge base` field
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Field is empty in fresh scaffold.
## Section 8.8 — Factory `merge strategy` field
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Renders `merge`; not proved as persisted runtime config.
## Section 8.9 — Factory `push merges` checkbox
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Checkbox renders unchecked; save not deeply exercised.
## Section 8.10 — Budget fields
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Budget controls are behind a collapsed disclosure; no scaffolded budget defaults were visible.
## Section 8.11 — Worktrees enabled checkbox
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Not visible until the collapsed disclosure is opened; not proven persisted.
## Section 8.12 — Workflow observer mode checkbox
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Not visible until the collapsed disclosure is opened; not proven persisted.
## Section 8.13 — Telegram approvals section
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `24-settings-telegram-errors.png`, `29-approvals-empty.png`
- **Notes:** Section renders, status is useful, but action results display raw JSON errors (`Bot token not configured`, etc.).
## Section 8.14 — API access / operator token section
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Masked token field and Verify/Clear/Save controls render.
## Section 8.15 — Save / Saved indicator
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `23-settings-snapshot.txt`
- **Notes:** Indicator renders `Saved`; modified save not deeply exercised on settings.
## Section 9.1 — Run list rendering
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `30-factory-page.png`, `35-home-multiproject.png`, `52-runs-route.png`
- **Notes:** Factory/home list recent runs. `/runs` itself renders `Project not found`, so there is no top-level run list route.
## Section 9.2 — Run detail rendering
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `06-run-detail-live-sse.png`, `07-run-detail-cancelled.png`
- **Notes:** Run detail renders live state, activity, controls, and cancelled state.
## Section 9.3 — Approve action
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `48-cli-approve-nonapproval.json`
- **Notes:** No real run reached approval because execution blocked earlier. Approve against a cancelled run returns `Run ... does not require approval`.
## Section 9.4 — Cancel action
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `works`
- **Evidence:** `07-run-detail-cancelled.png`, `18-cli-status-cancel-events.txt`
- **Notes:** Dashboard cancel worked and recorded `operator.cancel`.
## Section 9.5 — Cost / token info
- **Claude's verdict:** `works`
- **Codex's verdict:** EXPANDED — `works`
- **Evidence:** `18-cli-status-cancel-events.txt`, `35-home-multiproject-snapshot.txt`
- **Notes:** Env-token run recorded real tokens/cost around `$0.46`, not just zero-cost stalled runs.
## Section 10.1 — `ductum --version`
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `01-npm-install.txt`
- **Notes:** Output was `0.1.1`.
## Section 10.2 — `ductum --help`
- **Claude's verdict:** `partial`
- **Codex's verdict:** DISPUTED — `partial`
- **Evidence:** `31-cli-help-more.txt`, `17-cli-command-help.txt`, `42-init-help.txt`
- **Notes:** Top-level help in npm install listed the broad command surface, including init/login/start/doctor/status/cancel/events. The remaining issue is inconsistent subcommand help output; `init --help` and `cancel --help` emit JSON.
## Section 10.3 — Default `--api-url`
- **Claude's verdict:** `broken`
- **Codex's verdict:** CONFIRMED — `broken`
- **Evidence:** `31-cli-help-more.txt`, `47-cli-doctor.json`
- **Notes:** Help default is `http://localhost:4100`; init uses an ephemeral loopback port.
## Section 10.4 — `ductum login` (PKCE)
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `oauth-snapshot.txt`, `54-enter-during-pkce.txt`
- **Notes:** URL emission works, but browser completion was blocked in my environment and the resulting credential shape still fails SDK execution.
## Section 10.5 — `ductum spec import`
- **Claude's verdict:** `works`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `36-cli-spec-import.json`, `37-cli-spec-import-valid.json`, `38-cli-spec-import-waived.json`
- **Notes:** CLI direct import works with `--waive-contract`. The published `hello-readme` sample is blocked without waiver because its Slop Review is considered weak.
## Section 10.6 — `ductum --json queue`
- **Claude's verdict:** `works`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `38-cli-spec-import-waived.json`, `55-final-queue.json`
- **Notes:** Queue renders, but it listed a cancelled run under `activeRuns`.
## Section 10.7 — `ductum run <taskId>`
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `11-run-with-env-token-dispatch.json`, `16-env-token-fresh-run.txt`
- **Notes:** Dispatch works; execution then hits auth/workflow blockers.
## Section 10.8 — `ductum status <runId>` URL output
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `18-cli-status-cancel-events.txt`
- **Notes:** Status command works, but emitted URL was `http://localhost:5176/runs/...`, not the actual dashboard port.
## Section 10.9 — `ductum cancel <runId>`
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `partial`
- **Evidence:** `18-cli-status-cancel-events.txt`
- **Notes:** CLI on an already-cancelled run returns a structured 409 conflict. Fresh CLI cancel was not exercised; dashboard cancel was.
## Section 10.10 — `ductum events` SSE stream
- **Claude's verdict:** `not-tested`
- **Codex's verdict:** new — `works`
- **Evidence:** `18-cli-status-cancel-events.txt`
- **Notes:** Event stream emitted run/task/factory events.
## Section 10.11 — `ductum doctor`
- **Claude's verdict:** `works`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `47-cli-doctor.json`
- **Notes:** Doctor is useful, but reports stale dashboard URL `http://localhost:5176` and says `claude is not available` even though the SDK package contains a bundled binary not on PATH.
## Section 11.1 — Bundled `claude` binary present
- **Claude's verdict:** `partial-data`
- **Codex's verdict:** CONFIRMED — `partial-data`
- **Evidence:** `50-claude-binary-path.txt`
- **Notes:** Binary exists under the SDK package; `command -v claude` returns nothing.
## Section 11.2 — Credentials file shape
- **Claude's verdict:** `partial-data`
- **Codex's verdict:** CONFIRMED — `partial-data`
- **Evidence:** `04-seeded-credential-shape.txt`, `13-refresh-container-credential.txt`
- **Notes:** Shape is `{claudeAiOauth:{accessToken,refreshToken,expiresAt}}`.
## Section 11.3 — SDK error at runtime
- **Claude's verdict:** `broken (showstopper)`
- **Codex's verdict:** EXPANDED — `broken`
- **Evidence:** `14-file-shape-fresh-token-run.txt`, `15-file-shape-fresh-token-log.txt`
- **Notes:** Even with a freshly refreshed token in `.credentials.json`, file-shape auth produced `Not logged in · Please run /login`.
## Section 11.4 — Root cause hypothesis
- **Claude's verdict:** `hypothesis (needs validation)`
- **Codex's verdict:** EXPANDED — `works`
- **Evidence:** `12-env-token-result.txt`, `13-refresh-container-credential.txt`, `16-env-token-fresh-run.txt`, `06-run-detail-live-sse.png`
- **Notes:** Hypothesis validated with one caveat: stale env token returns 401; freshly refreshed `CLAUDE_CODE_OAUTH_TOKEN` lets the agent run. The remaining gap is credentials-file loading/shape. A second blocker then appears: the scaffold has no README, so the workflow blocks in understand on `file_read("README.md")`.
## Section 11.5 — D159 fix verified
- **Claude's verdict:** `works (within its scope)`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `05-init-result.txt`, `14-file-shape-fresh-token-run.txt`
- **Notes:** API startup accepts the credentials file; runtime execution does not.
## Section 12.1 — Default workflow profile
- **Claude's verdict:** `broken (auto-naming regression)`
- **Codex's verdict:** DISPUTED — `broken`
- **Evidence:** `49-factory-config-files.txt`, `56-workflow-assets.txt`
- **Notes:** Clean scaffold did not have Claude's `workflow-2` duplicate. The real clean issue is missing local workflow/profile wiring: package has `dist/workflows`, factory dir does not.
## Section 12.2 — Default sandbox profile
- **Claude's verdict:** `broken (schema mismatch)`
- **Codex's verdict:** EXPANDED — `broken`
- **Evidence:** `49-factory-config-files.txt`, `21-agents-save-roundtrip-snapshot.txt`
- **Notes:** Clean YAML has `sandboxes: []` while `claude-builder` references `sandboxRef: worktree-default`; saving agents fails because that ref is missing.
## Section 12.3 — Default notification channel
- **Claude's verdict:** `partial`
- **Codex's verdict:** DISPUTED — `broken`
- **Evidence:** `49-factory-config-files.txt`
- **Notes:** Clean YAML has `notificationChannels: []` while the agent references `notificationChannelRef: stdout`. Claude's disabled-Telegram default was contaminated-state data.
## Section 12.4 — Default model + harness for claude-builder
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `49-factory-config-files.txt`
- **Notes:** Model/harness refs are sane. Sandbox/channel refs are missing.
## Section 12.5 — Default port for `ductum init` API
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `05-init-result.txt`, `31-cli-help-more.txt`
- **Notes:** Random port works locally but breaks default CLI URL assumptions.
## Section 13.1 — hello-readme sample spec present
- **Claude's verdict:** `works`
- **Codex's verdict:** CONFIRMED — `works`
- **Evidence:** `46-npm-pack-contents.json`
- **Notes:** Sample files are present.
## Section 13.2 — Sample task name vs harness expected name
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `08-queue-after-imports.json`, `38-cli-spec-import-waived.json`
- **Notes:** Welcome sample created `append-readme-line`; CLI import of bundled directory created `P1-HELLO-README`. There are two sample-import paths with different task names.
## Section 13.3 — Bundled workflow files
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `56-workflow-assets.txt`, `49-factory-config-files.txt`
- **Notes:** Package ships `dist/workflows/coding-guard*.yaml`; fresh factory dir does not copy or visibly reference those files.
## Section 14.1 — README.md in published package
- **Claude's verdict:** `partial`
- **Codex's verdict:** CONFIRMED — `partial`
- **Evidence:** `46-npm-pack-contents.json`
- **Notes:** README is shipped; it does not warn about pnpm build policy, token-undefined, or SDK credential-file failure.
## Section 14.2 — CLI `--help` parity
- **Claude's verdict:** `broken`
- **Codex's verdict:** DISPUTED — `partial`
- **Evidence:** `31-cli-help-more.txt`, `17-cli-command-help.txt`, `42-init-help.txt`
- **Notes:** Top-level help is not missing half the commands in my npm install. The real parity issue is inconsistent human vs JSON help across subcommands.
## Section 14.3 — Error messages with `suggestedActions[].cmd`
- **Claude's verdict:** `partial`
- **Codex's verdict:** EXPANDED — `partial`
- **Evidence:** `43-tui-codex-acquisition.txt`, `44-tui-copilot-acquisition.txt`, `53-init-existing-dir.txt`, `48-cli-approve-nonapproval.json`
- **Notes:** Auth and existing-init errors have useful next steps. Some CLI/runtime errors remain plain strings, and spec import uses `nextCommands` instead of a consistent suggested-actions shape.

## Cross-cutting confirmations

Section X mostly holds: the shipped surface has stale schema wiring, placeholder ids leaking into UI, hardcoded defaults that do not match init reality, and a doctor-to-fix mismatch. I would narrow a few claims:

- Claude's `workflow-2` and disabled-Telegram defaults did not reproduce in a clean `0.1.1` scaffold. Those look contaminated by the Lima run.
- The clean scaffold is still broken: `sandboxRef: worktree-default` and `notificationChannelRef: stdout` point at empty resource lists.
- The published sample spec is present, but CLI import blocks it without `--waive-contract` because its Slop Review is considered weak.
- The browser handoff bug is two separate issues: init prints `token=undefined`; valid handoff exchange itself worked cleanly in my run.

## Codex's verdict on remediation R1-R4

I agree with R2 first, but the fix scope is now sharper: inject or translate a fresh Claude OAuth token for `claude-agent-sdk`, fix `token=undefined`, fix API/dashboard URL discovery, and fix the missing default sandbox/channel refs. Those are the minimal P5 blockers.

R1 is still needed for dashboard quality, but it should not be based on contaminated `workflow-2`/Telegram evidence. It should be based on clean reproducibles: agent editor `0`, bad add-agent defaults, save failure, missing project/spec edit affordances, stale settings fields, raw Telegram JSON errors, and inconsistent CLI help.

R3 still stands: retry P5 only after the targeted execution and handoff bundle lands. R4 also stands: future exit demos need real visual CRUD coverage plus one negative path per shipped surface.

## Items Claude got materially wrong

- Section 3.8: Enter during PKCE wait did not fail in my run; it kept waiting until Ctrl+C.
- Section 4.1: Valid handoff did not double-exchange or produce a 410.
- Section 4.2: `token=undefined` route does show a clear expired-link message.
- Section 4.4: File-upload spec import works.
- Section 4.5: Create Sample showed visible success feedback in clean state.
- Section 8.1: The operator-token banner is not global; authenticated auto-detect pages show connected.
- Section 10.2 / 14.2: Top-level `ductum --help` is much more complete than Claude reported, though subcommand help is inconsistent.
- Section 12.1 / 12.3: `workflow-2` and disabled Telegram defaults did not reproduce in clean state.
- Section 11.4: The env-var hypothesis is now validated. A fresh `CLAUDE_CODE_OAUTH_TOKEN` makes the agent run; the credentials-file shape/loading is the runtime auth gap.
