# Post Source-Of-Truth Future Backlog

## Status

Parking lot for work after the Factory Settings source-of-truth P2-P9 arc.

These items are not part of P2, P3, or any active source-of-truth stage unless a
later prompt explicitly promotes one into its own scoped stage. Each item needs
a separate prompt, acceptance criteria, and verification before implementation.

## Sequencing Rule

Finish the DB-only Factory Settings source-of-truth arc first:

- init writes SQLite directly
- YAML settings paths are removed from normal operation
- runtime current-vs-desired is honest
- secrets are encrypted and write-only
- dashboard Settings is rebuilt on typed APIs
- agent, harness, and model config is clearer

After that, choose from this backlog by operator leverage and risk.

## 1. Best-Of-N And Cheap-Model Routing

Goal: make Ductum run the same work through multiple agents/models, compare
results, and prefer cheaper winners when quality gates pass.

Add:

- structured bakeoff verdict evidence with winner, scores, reasons, cost, and
  verification status
- selection policy such as "passed verify and review, cheapest first"
- auto-route the winner into the normal approval and merge path
- compare UI with candidate diffs, cost, tokens, verdicts, and manual pick
- outcome-based routing stats by task type, model tier, cost, and result
- escalation ladder from cheap agents to stronger agents on failure

Why:

- turns existing bakeoff work into an operator-grade loop
- makes cheap-model usage evidence-based instead of manual
- creates labeled data for future routing decisions

Tradeoffs:

- structured verdicts must be reliable before auto-merge
- comparison UI can become noisy if candidate grouping is not first-class
- outcome routing can overfit until there is enough history

## 2. Deployment Hardening

Goal: make the local/self-hosted runtime shape explicit and safer.

Add:

- two named deployment modes: local single-operator and self-hosted server
- fail-closed operator-token posture, with explicit dev/test exceptions only
- route-by-route `/api/internal/*` auth review instead of broad exemption
- `/api/ready` distinct from `/api/health`
- process supervision guidance for launchd, systemd, or compose
- graceful drain on shutdown so active attempts are stalled or resumed
  intentionally
- startup warnings when runtime exposure and auth posture do not match

Why:

- Ductum controls code-executing agents
- public/self-hosted operation has different risk than loopback dogfooding
- current Docker/runtime shape is easy to misunderstand

Tradeoffs:

- stricter local auth adds setup friction
- process supervision differs by platform
- graceful drain needs careful interaction with session reconciliation

## 3. Agent Env And Secret Containment

Goal: stop harness children from inheriting the full operator environment.

Add:

- per-harness and per-agent environment allowlists
- encrypted secret refs as the normal way to inject provider credentials
- runtime secret resolution paths that never expose plaintext in API reads
- evidence/log/output redaction tests for injected values and refs
- warnings for agents that request broad environment access

Why:

- inherited env is the largest practical secret blast radius
- P5 encrypted secrets only matter if runtime injection is disciplined
- this is useful before full sandboxing exists

Tradeoffs:

- agents may lose implicit access to credentials they currently rely on
- provider auth setup has to become clearer in Settings
- debugging failed auth gets harder unless diagnostics are good

## 4. Real Sandbox And Resume Path

Goal: move beyond host worktree isolation and make interrupted sessions
recoverable.

Add:

- session resume for Claude and Codex where supported
- persisted resume handles bound to existing `session_run_mapping`
- explicit resume vs restart behavior in run history
- stronger execution boundary later: lower-privilege user, container, or
  platform-specific sandbox
- resource limits and network/credential policies as real runtime enforcement

Why:

- worktrees are useful isolation, but not a security boundary
- resume reduces wasted cost and operator babysitting
- sandbox-as-resource becomes real only when runtime enforces it

Tradeoffs:

- vendor resume semantics differ
- stronger sandboxing is platform-specific
- containerized execution increases operational complexity

## 5. Operational UI

Goal: make daily operation faster and easier to scan.

Add:

- unified inbox for approvals, failed runs, repair items, stale attempts, and
  integrity issues
- cost and throughput dashboard
- agent leaderboard: success rate, cost per merged task, duration, failure mode
- diff view on any run, not only approval runs
- manual "start attempt with agent X" action
- keyboard triage for approvals and queue navigation
- responsive cleanup for pages still using fixed inline grids

Why:

- operators need one place that answers "what needs attention"
- best-of-N needs cost and agent comparison visibility
- current information is split across multiple pages

Tradeoffs:

- unified inbox requires one canonical attention model
- dashboards need stable metrics definitions
- frontend-heavy tasks should be reviewed carefully for visual regressions

Execution note:

- Frontend-heavy tasks are good candidates for Claude Fable execution or review
  while evaluating that model. Keep API contracts and domain policy work with a
  backend-focused reviewer.

## 6. Light DDD Adoption

Goal: use the reference project pattern selectively without a broad core
rewrite.

Add the pattern only at new or actively touched seams:

- pure domain policy modules for selection, routing, secrets, runtime desired
  vs current, and redaction
- application use-case functions for init seeding, bakeoff completion, secret
  writes, and runtime settings writes
- repository ports where behavior needs isolated tests or alternate storage
- concrete infrastructure adapters behind existing SQLite repos

Why:

- makes policies testable without API or DB setup
- reduces pressure on dispatcher mixins over time
- matches the useful parts of `personal-memory-gateway` without importing its
  full structure wholesale

Tradeoffs:

- big-bang re-layering would churn audited core code
- too many folders for small features can slow implementation
- class-based repos already exist, so prefer interfaces plus existing class
  adapters rather than switching styles

## 7. Cleanup And Debt

Goal: remove stale surfaces after source-of-truth and harness settings are
stable.

Add:

- OpenCode removal as a real staged cleanup, not an immediate safe-delete
- harness CHECK constraint repair, including missing `copilot-sdk` and stale
  removed harness IDs
- `/agents` and `/specs` legacy-label product decision
- stale file-size grandfather list cleanup
- unused UI component removal such as `ActivityTimeline`
- decorative or misleading UI elements cleanup where they imply data they do
  not show

Why:

- stale surfaces make Settings and harness behavior harder to reason about
- some cleanup touches DB constraints and tests, so it needs a proper stage

Tradeoffs:

- OpenCode/plugin-probe removal may affect tests and internal routes
- CHECK constraint cleanup requires SQLite table rebuilds
- hiding old nav surfaces can remove useful debug escape hatches

## 8. DB Safety

Goal: make SQLite authority safer before more non-additive changes.

Add:

- pre-migration DB snapshot including WAL/SHM handling
- populated fixture DB migration tests
- backup/restore runbook
- optional active-run uniqueness constraint if multi-process access becomes
  supported
- startup detection for multiple writers if single-process remains the model

Why:

- DB-only source of truth raises the cost of migration mistakes
- backups are cheap compared with losing factory state

Tradeoffs:

- backups add startup time and disk use
- unique constraints can conflict with future best-of-N semantics if not scoped
  carefully
- multi-process safety may be unnecessary if Ductum stays single-writer

## 9. Unified Harness Accounting

Goal: make cost, token, turn, and duration accounting comparable across
harnesses.

Add:

- one normalized accounting record for all harnesses
- per-vendor raw usage payload capture with redaction
- cost attribution by run, attempt group, agent, model, project, and task type
- UI summaries that separate estimated, billed, and unknown costs
- tests for cache-aware and provider-specific pricing behavior

Why:

- best-of-N depends on fair cross-model comparison
- budget enforcement and dashboards need one accounting contract

Tradeoffs:

- vendors report usage differently
- live pricing refresh can drift from actual billed cost
- historical runs may need "unknown" or estimated labels

## 10. Issue Backlog Intake And Reconciliation

Goal: make GitHub issues a first-class intake source without letting issues,
specs, and Ductum tasks drift into three separate backlogs.

Add:

- issue triage pass before creating any post-source-of-truth stage
- mapping from GitHub issue to Ductum Spec/Task when work is promoted
- labels for status such as candidate, promoted, duplicate, blocked, deferred,
  and shipped
- source links from Ductum specs back to the original issues
- close/comment rules when a Ductum task ships issue-backed work
- duplicate detection between this future backlog, existing issues, and new
  operator notes

Why:

- the issues already contain backlog signal
- Ductum should reduce backlog babysitting, not create another place to check
- issue-backed work needs traceability from idea to implementation evidence

Tradeoffs:

- syncing issue state can become busywork if too detailed
- GitHub labels need a simple taxonomy or they become another cleanup problem
- not every issue deserves a Ductum task; some should stay parked or close

## Open Questions

- Which future track should become the first post-source-of-truth stage?
- Should best-of-N use sibling tasks forever, or introduce a first-class attempt
  group?
- Should self-hosted mode require a reverse proxy/TLS assumption from day one?
- Which sandbox boundary is acceptable for macOS dogfooding before Linux
  sandboxing exists?
- How much of the light DDD structure should be allowed inside `@ductum/core`
  before it becomes folder ceremony?
- Should issue intake be manual triage only, or should Ductum eventually sync
  labels/comments automatically through GitHub?
