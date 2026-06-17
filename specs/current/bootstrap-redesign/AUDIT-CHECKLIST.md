# Bootstrap-Redesign Arc — Audit Checklist

**Status:** Open. Authored 2026-05-05 per D161 (arc paused, audit-first).

**Driving question:** What does `ductum@0.1.1` actually do for a
fresh user, and which of those surfaces work?

**Output target:**
`specs/current/bootstrap-redesign/AUDIT-FINDINGS.md` (new file the
audit produces; should not exist until the audit completes).

## How to run the audit

1. Use the existing Lima VM at `macmini-1.sunrise.box:.lima/p5-exit-demo/`
   if it's still up — it has a clean-ish 0.1.1 install. OR install
   fresh in a new container/user account. Do not audit on the dev
   laptop — accumulated state will mask findings.
2. For each section below, follow the steps and record the verdict.
3. Verdicts use exactly these labels:
   - `works` — behaves as expected, no surprises
   - `partial` — works in the happy path but has named friction
     (record the friction)
   - `broken` — produces incorrect behavior, errors, or no-ops
   - `unimplemented` — surface exists in code or copy but does
     nothing meaningful
   - `not-shipped` — surface doesn't exist in 0.1.1 at all
4. Record evidence as you go: stdout/stderr fragments, screenshots,
   API responses. Save to
   `specs/current/bootstrap-redesign/evidence/audit/`.
5. Do not fix anything during the audit. Note findings only. Fixes
   come after the audit reaches a coherent picture.
6. When complete, draft `AUDIT-FINDINGS.md` summarizing each
   section's verdict + recommended remediation scope.

## Sections

### 1. Bootstrap install path

- [ ] `pnpm install -g ductum@0.1.1` on a fresh user — does the
      better-sqlite3 binding build? Does it warn? Does it require
      `--allow-build`? Verdict: ___
- [ ] `npm install -g ductum@0.1.1` on a fresh user — does it work
      out-of-box (npm runs install scripts by default)? Verdict: ___
- [ ] Tarball contents include the bundled hello-readme sample? The
      LICENSE? README? Verdict: ___

### 2. `ductum init` TUI — happy path

- [ ] Welcome screen renders. Verdict: ___
- [ ] Directory prompt: validates path, accepts default,
      rejects existing factory dir. Verdict: ___
- [ ] Project name prompt: slug-validated. Verdict: ___
- [ ] Confirm scaffold: shows correct yaml preview. Verdict: ___
- [ ] Anthropic auth: PKCE flow runs, callback succeeds, writes
      credentials.json. Verdict: ___
- [ ] Codex auth: skip path. Acquisition path. Verdict: ___
- [ ] Copilot auth: skip path. `gh auth login` path. Device-code
      path. Verdict: ___
- [ ] Agent picker: select claude-builder. Multi-select with
      multiple providers. Verdict: ___
- [ ] Scaffold step: writes ductum.yaml, .gitignore, .ductum/, runs
      `git init` + initial commit. Verdict: ___
- [ ] API start: succeeds with PKCE creds (D159). Verdict: ___
- [ ] Dashboard URL surfaced: token in URL is the real operator
      token, not "undefined" (#3). Verdict: ___

### 3. `ductum init` TUI — failure paths

- [ ] Re-running init in an existing factory dir. Verdict: ___
- [ ] Cancelling at each prompt with Ctrl+C — does scaffolder roll
      back? Verdict: ___
- [ ] Cancelling during PKCE wait — error envelope shape. Verdict: ___
- [ ] PKCE callback timeout. Verdict: ___
- [ ] PKCE callback port collision. Verdict: ___
- [ ] Invalid project name. Verdict: ___
- [ ] Unwritable directory. Verdict: ___

### 4. Dashboard `/welcome` route

- [ ] Route loads with valid token in URL. Verdict: ___
- [ ] Route handles `?token=undefined` gracefully (or fails with a
      clear error). Verdict: ___
- [ ] Token-to-cookie exchange happens on first load. URL is
      stripped after exchange. Verdict: ___
- [ ] "Import your first spec" UI works (file upload). Verdict: ___
- [ ] "Create Sample" / "Dispatch a sample task" button works.
      Verdict: ___
- [ ] After sample import, dispatch happens automatically (#6) OR
      requires explicit operator action (document which). Verdict: ___
- [ ] SSE event stream renders progress. Verdict: ___

### 5. Dashboard CRUD — agents

- [ ] Adding a new agent: form fields, validation, defaults,
      pickers vs text boxes. Verdict: ___
- [ ] Selecting model (Opus / Sonnet / Haiku): is there a picker or
      a text box? Does the operator have to know exact model IDs?
      Verdict: ___
- [ ] Selecting harness: picker or text box? Verdict: ___
- [ ] Selecting sandbox profile: picker or text box? Verdict: ___
- [ ] Editing an existing agent: form pre-fills correctly. Verdict: ___
- [ ] Deleting an agent: confirmation, side effects. Verdict: ___
- [ ] Defaults for a new agent: do they produce a runnable agent or
      a half-built one? Verdict: ___

### 6. Dashboard CRUD — projects

- [ ] Adding a project. Verdict: ___
- [ ] Editing a project. Verdict: ___
- [ ] Deleting a project. Verdict: ___
- [ ] Project assignments to agents. Verdict: ___

### 7. Dashboard CRUD — specs

- [ ] Importing a spec via the dialog. Verdict: ___
- [ ] Editing a spec. Verdict: ___
- [ ] Setting spec status. Verdict: ___
- [ ] Spec list displays statuses correctly (badges, filters).
      Verdict: ___

### 8. Dashboard settings menu

- [ ] Each settings field: does it persist? Does it take effect?
      Verdict (per field): ___
- [ ] Output mode toggle (D135 §1). Verdict: ___
- [ ] Notification channel configuration. Verdict: ___
- [ ] Token / API access management. Verdict: ___
- [ ] Telegram integration setup. Verdict: ___

### 9. Dashboard run views

- [ ] Run list renders. Verdict: ___
- [ ] Run detail renders. Verdict: ___
- [ ] Approval action works end-to-end. Verdict: ___
- [ ] Cancel action works (D145). Verdict: ___
- [ ] Cost / token info displayed. Verdict: ___

### 10. CLI — happy path

- [ ] `ductum --version` returns the version. Verdict: ___
- [ ] `ductum --help` lists every command. Verdict: ___
- [ ] `ductum login` PKCE flow. Verdict: ___
- [ ] `ductum spec import`. Verdict: ___
- [ ] `ductum queue --json`. Verdict: ___
- [ ] `ductum run`. Verdict: ___
- [ ] `ductum status <runId>`. Verdict: ___
- [ ] `ductum approve <runId>`. Verdict: ___
- [ ] `ductum cancel <runId>` (D145). Verdict: ___
- [ ] `ductum events` SSE stream (D139). Verdict: ___

### 11. Agent execution — claude-agent-sdk

- [ ] After PKCE, can the dispatcher actually run a claude-builder
      agent end-to-end? (#7 says no on 0.1.1). Verdict: ___
- [ ] Credentials format expected by claude-agent-sdk vs format
      written by `ductum login`. Document the gap. Verdict: ___
- [ ] Reproducible test: does setting `CLAUDE_CODE_OAUTH_TOKEN` env
      directly let agents run? Verdict: ___

### 12. Defaults audit

- [ ] Default workflow profile in ductum.yaml — does it work? Verdict: ___
- [ ] Default sandbox profile — does it work? Verdict: ___
- [ ] Default notification channel (stdout) — does it produce
      output? Verdict: ___
- [ ] Default model + harness for claude-builder — runnable?
      Verdict: ___
- [ ] Default port for `ductum init`'s API — collides with anything?
      Verdict: ___

### 13. Bundled assets

- [ ] `assets/specs/examples/hello-readme/` is in the published
      tarball. Verdict: ___
- [ ] The hello-readme task is named `append-readme-line`; is that
      consistent with what the harness expects (#5)? Verdict: ___
- [ ] Bundled workflows (`workflows/coding-guard.yaml`,
      `workflows/coding-guard-template.yaml`) are present. Verdict: ___

### 14. Documentation parity

- [ ] README.md in the published package matches reality. Verdict: ___
- [ ] CLI `--help` output matches reality. Verdict: ___
- [ ] Error messages with `suggestedActions[].cmd` reference real
      commands that work. Verdict: ___

## Output format for AUDIT-FINDINGS.md

Section by section, mirror the checklist headers. For each item:

```
- Verdict: <works|partial|broken|unimplemented|not-shipped>
- Evidence: <path or quote>
- Recommended remediation scope: <inline-fix|next-bundle|own-arc|defer>
- Notes: <free-text>
```

Then a top-level summary:

```
## Summary
- Total items: N
- works: X
- partial: Y
- broken: Z
- unimplemented: W
- not-shipped: V

## Verdict on the arc
<one paragraph: is bootstrap-redesign closeable on a narrowed
contract, or does the dashboard need its own arc first?>
```

## When to stop the audit

The audit is done when every item above has a verdict and at least
one piece of evidence (or an explicit "not applicable, here's why").
Don't skip items because they look obviously broken — name the
breakage explicitly. Don't skip items because they look obviously
fine — verify on the clean install.

## Slop review (for the audit itself)

- Attack any audit close that doesn't list every CRUD form / every
  default / every settings field individually.
- Attack any audit that lumps multiple findings under "broken UX"
  without naming each.
- Attack any audit that fixes-as-it-goes — fixes belong after, not
  during.
- Attack any audit done on the dev laptop instead of a fresh
  install.
