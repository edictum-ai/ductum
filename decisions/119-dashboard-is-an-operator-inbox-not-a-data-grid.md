---
date: 2026-05-01
status: proposed (design principle; implementation pending P2-followup spec)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 109, 115
---

# Decision 119: The dashboard is an operator inbox, not a data grid

## Context

On 2026-05-01, mid-Phase-B of the factory-readiness-recovery, the
operator opened the dashboard and asked, in plain words: *"I don't
understand the UI. I don't know where to click. If I should ignore
something, why is it there? If it's important, why can't I
understand it? Why is it so misleading?"*

That is a design failure, not a comprehension failure.

Specific observations from that session:

- **All four specs on `/specs?tab=All` showed red "failed" stage
  bars.** The bar reflects *how many runs across all attempts of the
  spec failed*, not the spec's logical state. P3 had three failed
  dispatches and one in-flight; the bar drew four red stripes.
  Adjacent column showed `recovering` as the actual status — two
  pieces of state contradicting each other in the same row.
- **`factory-readiness-recovery` displayed `failed 10 tasks` in the
  stage badge while its status column read `recovering`.** Both are
  technically correct in the schema; together they say nothing
  honest to a human.
- **`INTEGRITY WATCH` cards repeated three times on the home page**
  (top, ACTIVE SPECS panel sibling, bottom). Each card showed
  `done_task_without_lineage_or_external_outcome` and the label
  `inconsistent` for P0/P1/P7 — operator-direct work that shipped
  without a Ductum run. The cards were not actionable; the operator
  could neither resolve them from the card nor click anything.
- **`RECENT DECISIONS` showed five rows, all of which were
  auto-imported `Decision Trace` blocks from spec frontmatter.** The
  operator's actual decisions of the day (D114, D115, D116, D118)
  were not in the panel. The label "Recent Decisions" lied about
  what was being shown.
- **`EXECUTION MODES` table** used the labels `orchestrated`,
  `external`, `recorded`, `unknown`, `inconsistent`. These are
  internal classifications written by an engineer for an engineer.
  An operator reading this for the first time has no idea what to
  do with `unknown: 3`.
- **The home page never answers the question "what is your next
  action?".** It answers "what does the database currently
  contain?" — a different question.

These were not the operator misreading the screen. The dashboard
was built as a faithful read-out of every database field, not as a
curated surface that tells the operator what they need to do next.

## Decision

**The dashboard is an operator inbox. Every screen earns its place
by answering a question of the form "what should I do, and where?"
No screen earns its place by being a data dump.**

This Decision is a design principle, not a list of features. It
governs all future dashboard work. It does **not** invalidate or
re-scope P2 (`P2-DASHBOARD-TRUTHFULNESS`) — P2 ships its current
contract as written. D119 governs the dashboard work that comes
*after* P2 lands.

### The five rules every dashboard surface must follow

1. **Visible = actionable, or one click away from actionable.**
   If a card or row exists on a dashboard page, it must lead the
   operator either (a) to a thing they can do here, or (b) to a
   detail page where they can do something. Cards that are
   read-only with no action and no drill-down do not appear at
   all. The information may still be in the database; it does not
   appear on the dashboard until it has a purpose.

2. **Labels are human-readable, not internal state names.**
   No label on a dashboard surface is permitted to be a verbatim
   internal enum value (`orchestrated`, `inconsistent`,
   `cost_budget_paused`, `recovering`). Labels are written for an
   operator who has never read the source code. The mapping from
   internal state to human label is a UI concern, not a
   "documentation" concern that can be deferred.

3. **No contradictory state on the same row.**
   If two fields can disagree (a stage progress bar that summarizes
   run failures alongside a status column that reflects the spec's
   logical state), the UI picks one and shows it. The other goes
   on the detail page if it has explanatory value, or is dropped.
   The user does not have to reconcile two engine-internal
   accounting systems on a single screen.

4. **The home page answers "what is your next action?" in one
   sentence.**
   At the top of the home page, before any tables or grids, there
   is a single sentence the operator can act on: *"Approve run
   X."* / *"Run hit budget cap; extend or deny here."* / *"3 specs
   need attention — review on /specs."* / *"Nothing pending; the
   factory is running."* That sentence drives the rest of the
   page. The grids stay; they sit beneath the prescription, not
   instead of it.

5. **Status badges represent logical state, not worst-sub-component
   state.**
   A spec's status badge reflects the spec's status field. The
   per-stage failure history of its runs is a separate, named
   visualization on the detail page, not a competing summary
   adjacent to the status badge. If a stage progress bar exists
   on the list view, it depicts the spec's *progress*, not its
   *failure history*.

### What this means for the existing surfaces

Each rule, applied to today's UI:

| Rule | Surface that violates it today | Disposition |
|---|---|---|
| 1 | INTEGRITY WATCH cards on home (read-only, no drill action) | Move to a `/integrity` page; on home, replace with a single line: "3 integrity issues — review on /integrity" |
| 1 | EXECUTION MODES table on home (read-only, no action) | Move to `/integrity` or drop |
| 2 | "RECOVERING", "INCONSISTENT", "ORCHESTRATED" labels | Replace with sentences: "Has failed runs but spec is running" / "Marked done but Ductum has no run record" / "Ran through Ductum" |
| 3 | Spec list `STAGE: failed` badge alongside `STATUS: recovering` | Pick one (status). Move stage progress to the detail page. |
| 4 | Home page has no prescriptive line | Add an OPERATOR INBOX panel above OPERATOR PROGRESS that names the next action |
| 4 | RECENT DECISIONS panel | Either drop from home or rename to "RECENT DECISION TRACES (auto-imported)" — and only show on home if the operator can act on them |
| 5 | All 4 spec rows on `/specs?tab=All` showing red bars | Stage bar reflects spec progress (how many tasks done), not run failure history |

### Out of scope for D119

- Wireframes or pixel-level designs. D119 is the principle; the
  P-future spec will own the wireframes and the per-page acceptance
  criteria.
- Replacing the existing layout engine, library, or component set.
  This is information architecture, not a frontend rewrite.
- Telegram, Slack, or any out-of-dashboard surface. D119 governs
  the in-app dashboard; notification surfaces follow their own
  decisions (e.g. Decision 055 for NotificationChannel transports).

## Acceptance criteria for the future P-spec that implements D119

A future spec — provisional name `dashboard-operator-inbox` —
implements D119. It cannot land without:

1. The home page begins with a single-sentence prescription that
   reflects the factory's actual state, written by a function that
   takes the OperatorBrief and returns a string. That function has
   tests for at least: idle factory, single approval pending, budget
   pause, max-turns pause, multiple approvals pending, integrity
   issues only.

2. Every label on the home page passes a "first-day operator" test:
   if a person who has never read the Ductum source code reads the
   label, they can paraphrase what it means in their own words.
   Validated by walking three first-day testers through the page.

3. No spec list row shows two contradicting state visualizations
   (per Rule 3 + Rule 5). Decided by code-review against the rules
   in this decision, not by visual taste.

4. The dashboard's home page can be regression-tested with a
   snapshot test that asserts: the top sentence is present, no
   forbidden internal-enum labels appear (a denylist of strings
   like `inconsistent`, `orchestrated`, `cost_budget_paused`
   appearing literally as a UI label), and INTEGRITY/EXECUTION
   MODES sub-cards do not appear above the fold.

5. The decisions panel either disappears from home or is renamed
   per Rule 1 — and the rename matches what the panel actually
   shows (auto-imported decision traces, not operator-decided
   decisions).

The future spec records its own decision number; this one (D119)
is the design constitution it cites.

## Alternatives considered

1. **Fix the dashboard piece by piece in P2 alone.**
   Rejected. P2's contract is mechanical (replace text inputs with
   pickers, split decisions from imports, add search, etc.) and
   shipping all of D119 inside it would balloon the scope. P2
   ships as written; D119 is the next, larger pass.

2. **Treat the IA problem as documentation.**
   Rejected. "Add tooltips that explain `inconsistent`" is the
   same failure repeated. The labels themselves are the bug; you
   cannot tooltip your way out of writing for an engineer audience.

3. **Defer until after the dashboard has shipped externally.**
   Rejected. Every operator who walks up to the dashboard for the
   first time will have the same experience the operator had today.
   That is the dashboard's primary first-impression surface; its
   credibility is set there or nowhere.

## Consequences

- The post-P2 dashboard work has a north star. It can be planned,
  scoped, and accepted against the rules in this decision rather
  than against engineering taste.
- Some existing surfaces (INTEGRITY WATCH on home, EXECUTION MODES
  table on home) are tagged for relocation rather than incremental
  polish. That decision is now defensible against re-litigation.
- The operator can point at this decision when reviewing future
  dashboard work. "Does this comply with D119?" is the meaningful
  question. "Does this look prettier?" is not.
- D115 gains a Gap 7 entry that points here, so the cumulative
  Stage-1 finding log captures the IA problem alongside the CLI
  gaps. They have a shared root: *engineering shipped the data;
  the curated operator surface was deferred.*

This decision is the operator's veto, written down.
