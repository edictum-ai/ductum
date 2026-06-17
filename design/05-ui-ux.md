# Operator Surfaces and UI/UX Redesign: One Token System, Brand-True Dark Terminal, Inbox-First IA, CLI/UI Parity by Contract

> Ductum redo · pillar design · 2026-06-17

The dashboard already has the right bones — a clean lazy-loaded routing shell, a six-item Sidebar, a working component library with 40 test files, and a bespoke "Signal" token system — but it is built on the wrong brand. Signal ships as a light-first editorial theme (cream #f6f3ec canvas, orange #ff9d5c accent, Geist font) that directly contradicts the brand book's near-black #111318 / signal-blue #2F6FED / Inter+Archivo Expanded+JetBrains Mono "Bloomberg terminal" direction. The redo is a strangler retheme, not a rewrite: collapse the dual design systems (signal/ inline-style tokens + shadcn ui/ + legacy stage-display.ts Tailwind class maps) into ONE token layer with CSS custom properties as the single source of truth, reskin to the dark/blue/mono brand in place, and let shadcn primitives keep working behind the bridge. On top of that retheme we sharpen the IA (delete TreeNavigator, RelativeTime, legacy /specs and /agents; fix the ProjectList-is-actually-Home naming trap), make the needs-you Inbox the spine of the home surface with a next-command on every item, add first-class intervention controls (approve/cancel/pause/resume/retry/redirect) wired to the run-control API, and harden the per-run evidence timeline with live follow. The whole pillar rides on one principle: every operator action is a thin call to the shared control-plane API, so CLI and UI stay at parity by construction and we add a parity conformance check to keep them honest.

---

# Operator Surfaces and UI/UX Redesign (ui-ux)

## Target shape

One token system, one brand, one inbox-first IA, CLI/UI parity by contract.

The dashboard becomes a **dark signal-terminal**: near-black canvas, a single
signal-blue accent reserved for "act here," machine-shaped mono for every ID /
state / latency / dollar figure, and decisive (not decorative) motion. It reads
like an instrument panel for supervising a fleet of governed agents — not a SaaS
landing page. The operator's default landing surface is the **needs-you Inbox**,
not a project grid. Every screen is a thin render over the shared control-plane
API (`packages/dashboard/src/api/client.ts` -> Hono API), and every operator
action has a named CLI equivalent over the same endpoint.

## What changes vs today (mapped to inventory dispositions)

Grounded in `inventory/domains/16-dashboard-ia.md` and
`inventory/domains/17-dashboard-components.md`.

### KEEP (carry forward, reskin only)
- **Routing shell** (`App.tsx:50-76`, `LazyRouteOutlet.tsx`) — correct 4-segment
  attempt path `/:project/:spec/:task/:runId`. Keep.
- **Layout shell + breadcrumbs** (`Layout.tsx`) — keep; drop the "Legacy
  specs/agents" crumb arms (`Layout.tsx:34-40`) when those routes die.
- **Sidebar + SidebarSpend** (`Sidebar.tsx`, `SidebarSpend.tsx`) — keep the
  canonical nav; drop the `/specs`->projects, `/agents`->settings special-cases
  (`Sidebar.tsx:53-54`).
- **Detail hierarchy** (ProjectDetail/SpecDetail/TaskDetail/RunDetail +
  `run-detail/*`) — keep the drilldown; fix the post-delete redirect bug
  (`SpecDetail.tsx:361` navigates to legacy `/specs`).
- **Operator action pages** (FactoryActivity, ApprovalQueue, Repair) — keep;
  these realize the wedge. Reframe them as Inbox sections (below).
- **Factory Settings** (`Settings.tsx`, `settings/*`) — keep; typed panels,
  no raw config editor. Reskin only.
- **Command palette** (`CommandPalette.tsx`, `command-palette-actions.tsx`) —
  keep; strongest cross-IA jump and already action-ordered by attention.
- **RunRedirect** (`RunRedirect.tsx`) — keep; deliberate CLI-output compat shim.
- **Approval / repair / evidence surfaces** (`approval/*`, `repair/*`,
  `run/*`, `evidence/TypedEvidenceRenderer.tsx`) — keep; typed/structured
  rendering is the legibility story.

### REUSE (keep behavior, reconcile name/skin)
- **Home dashboard** (`ProjectList.tsx`) — keep the page, **rename the module to
  `Home.tsx`** to kill the ProjectList-vs-Projects naming trap. Strip the
  one-time `homeLastSeen` localStorage->DB migration (`ProjectList.tsx:26-65`)
  once the migration window has passed. This page becomes the **Inbox spine**.
- **shadcn ui/ layer** (`ui/*.tsx`, 16 files) — keep the non-trivial primitives
  (dialog/select/table/tabs/sheet) but demote them to sit *behind* the unified
  token layer via the CSS-var bridge, not as a co-equal second vocabulary.
- **Welcome / first-run** (`Welcome.tsx`) — keep the onboarding flow; repoint
  its `/specs` link (`Welcome.tsx:144`) to a project-scoped or activity path.

### REDESIGN (rework in place)
- **Legacy stage-display.ts color maps** (`lib/stage-display.ts:1-86`) — the
  literal `bg-cyan-100 dark:...` Tailwind strings duplicate Signal tones and
  render side-by-side with signal tokens in the same file (`RunFeed.tsx:15`).
  Fold the status->color capability into the unified token layer
  (`statusTone()` returning a CSS var), keep `STAGE_LABEL` and `WORKFLOW_STAGES`
  as data, delete the literal class maps and the dead `opencode` harness color.
- **The two design systems themselves** — reconcile `signal/` (60 importers) and
  `ui/` (36 importers) into ONE token layer (see Components below). This is the
  headline rework.

### REMOVE (delete)
- **TreeNavigator** (`TreeNavigator.tsx`, 352 LOC, zero importers, holds a D112
  oversize grandfather slot) — delete and reclaim the exception.
- **RelativeTime** (`RelativeTime.tsx`, zero importers) — delete; `timeAgo` is
  used directly.
- **Legacy /specs SpecList + /agents AgentList** — delete both routes and
  pages after repointing the two inbound links (`Welcome.tsx:144`,
  `SpecDetail.tsx:361`). Remove the `Layout.tsx:34-40` and `Sidebar.tsx:53-54`
  special-cases that only exist to accommodate them.

### DECIDE (operator forks — see keyDecisions)
- **Fonts** — brand says Inter + Archivo Expanded + JetBrains Mono; app ships
  Geist. Recommend swap now (cheap: centralized in `tokens.ts` + `index.css`).
- **Bakeoff UI** — real and tested but peripheral; confirm it stays in the
  operator model.

## How this advances the four goals

- **Better shape:** one token system kills the dual-vocabulary smell; IA cleanup
  removes 4 dead/legacy surfaces; naming trap fixed. Fewer files, one mental
  model.
- **Better UI/design:** brand-true dark signal-terminal — disciplined, numerate,
  fail-closed. The accent blue is *rationed* to mean "act here," so the Inbox
  and intervention controls visually dominate, which is exactly the wedge.
- **Autonomous:** the Inbox-first home + next-command per item makes one operator
  supervise many runs. Live-follow + intervention controls (cancel/pause/resume)
  are the human-on-the-loop surface that lets autonomy run safely.
- **Extensible:** a single CSS-var token contract + a documented status->tone
  function means new run states, new agents, new evidence kinds theme themselves.
  CLI/UI parity by API contract means a new operator action lands once in the API
  and is reachable from both surfaces.

## Concrete components and the unified token plan

### Token layer (single source of truth)
- **CSS custom properties in `index.css` (`:root.dark`) are canonical**;
  `tokens.ts` mirrors them as TS constants (keep the documented
  no-CSSOM-read-per-render rationale). The shadcn `--background/--primary/...`
  aliases remain a *bridge* pointing at the same `--signal-*` vars, so shadcn
  primitives inherit the brand with zero per-component edits.
- **Reset the palette to brand** (the real defect today — current `:root` is a
  cream light theme with an orange accent):
  - `--signal-bg: #111318` (near-black canvas; current dark bg is `#0e1014`,
    move to the brand value)
  - `--signal-accent: #2F6FED` (single signal blue; replaces the orange
    `#ff9d5c` in BOTH themes — this is the most visible change)
  - Run-state tones become first-class, brand-locked: `done=emerald`,
    `failed=red`, `running=blue`, `queued=sky`. Map `--signal-ok/err/info` plus
    a new `--signal-queued` (sky) to these and route ALL status color through
    `statusTone(state)`.
- **Make dark the default and primary theme.** The brand is a dark terminal;
  light becomes optional/secondary, not the `:root` default. (Today `.dark` is
  an override on a light `:root`.)
- **Fonts:** `--font-sans: Inter`, `--font-display: 'Archivo Expanded'`
  (uppercase, display only), `--font-mono: JetBrains Mono`. Drop
  `@fontsource-variable/geist`; add Inter + Archivo Expanded fontsource packages
  (pinned exact versions, >=7-day publish buffer per supply-chain rule). Mono is
  load-bearing: every ID, run state, latency, and dollar figure renders in mono
  (the `Num`/`Mono` Signal primitives already exist — point them at JetBrains).
- **Motion tokens:** three durations 90/180/240ms with a single easing; codify as
  `--motion-fast/base/slow` and reuse existing keyframes (`live-dot`, `fade-in`).
  No decorative motion — motion signals state change only.
- **`agentColor()` hardcodes mimi/codex/glm/haiku** (`tokens.ts:49`) — replace
  the hardcoded roster with a deterministic hash-to-palette over the brand tones
  so a changing agent roster themes itself (extensibility).

### Component plan
- **Status primitive:** one `<StatusBadge state>` (mono label + tone dot) that is
  the *only* place status->color happens. Retire `STAGE_CLASSES`,
  `TASK_STATUS_CLASSES`, `EVIDENCE_CLASSES`, etc.
- **Inbox item:** `<InboxItem>` — kind (approval | block | failure | budget),
  what is blocked, why, the bound run/spec, and a **next-command** (one primary
  action + the copyable CLI equivalent). Reuses `approval/ApprovalCard`,
  `repair/*`, and failure banners as the typed bodies.
- **Intervention bar:** `<RunControls>` — approve / reject / cancel / pause /
  resume / retry / redirect, each a thin call to the run-control endpoints
  (the D146 SSE+cancel work proves the wiring). Every action opens a reason
  field; the reason is recorded (audit). Controls are gated by run state
  (no "resume" on a terminal run) — the API is authoritative, the UI mirrors.
- **Evidence timeline:** keep `run-detail/*` tabs but lead with an ordered
  **timeline** (transitions, gate decisions, tool authorizations, verifications,
  approvals, failures) each linked to its justifying evidence, with a **live
  follow** toggle driven by `useDuctumSSE`. This is the per-run proof view and
  the natural home for the evidence-cassette / proof-of-execution concept from
  the cross-pillar evidence work.
- **Cost strip:** keep `SidebarSpend`/`WeekPulse`; add per-run and per-spec cost
  in the run/detail headers in mono. Flag $0 Codex costs visibly (the silent-$0
  recording defect is a known REDESIGN elsewhere; the UI must not pretend $0 is
  real — render it as "unattributed," not "$0.00").

## Redesigned screen set (target IA)

1. **Home = Inbox** (`/`, module renamed `Home.tsx`): needs-you queue first
   (approvals, blocks, repeated failures, budget breaches), then Today/active
   runs, then recent decisions. Each inbox item carries a next-command.
2. **Activity** (`/activity`): ready-to-dispatch / needs-operator / running
   sections across projects (keep FactoryActivity).
3. **Approvals** (`/approvals`): the approval queue (keep).
4. **Repair / Doctor** (`/repair`): readiness + guided repair (keep); honest
   "can the factory dispatch?" status.
5. **Projects** (`/projects`) -> ProjectDetail -> SpecDetail -> TaskDetail ->
   RunDetail: the drilldown spine (keep).
6. **Factory Settings** (`/settings`): typed panels (keep).
7. **Welcome** (`/welcome`): first-run handoff (keep, repoint link).
- **Deleted:** TreeNavigator, RelativeTime, `/specs` SpecList, `/agents`
  AgentList.

## CLI <-> UI parity

Parity is the de facto architecture (both surfaces hit the same Hono API) but is
not *checked*. Make it explicit:
- Maintain an **operator-action manifest** (action id -> API endpoint -> CLI
  command -> UI control) and a **conformance test** asserting every entry has all
  three. This is the parity-by-contract guarantee, analogous to the cross-SDK
  fixture discipline (C-rules), applied to operator surfaces.
- The CLI prints canonical run hrefs that `RunRedirect` resolves; keep that.

## Strangler steps (route one real dogfood flow through each new seam)

1. **Token unification (no visual brand change yet):** introduce `statusTone()`
   in the token layer; migrate one surface (RunFeed) off `STAGE_CLASSES` onto it.
   Dogfood flow: a live run renders its stage via the new path only.
2. **Brand retheme in place:** flip `:root` to dark-default, set
   `--signal-accent: #2F6FED`, `--signal-bg: #111318`, swap fonts. Because shadcn
   is bridged to the same vars, both systems reskin at once. Dogfood: the whole
   dashboard renders brand-true with zero component edits.
3. **Delete dead code:** remove TreeNavigator + RelativeTime; reclaim the D112
   grandfather slot. Dogfood: `pnpm build` + size check stay green.
4. **Kill legacy routes:** repoint the two inbound links, delete `/specs` and
   `/agents`, drop the Layout/Sidebar special-cases, fix the SpecDetail
   post-delete redirect. Dogfood: delete a spec -> land on `/:project`, not a
   retired page.
5. **Inbox-first Home:** rename `ProjectList.tsx` -> `Home.tsx`, restructure as
   the needs-you Inbox with next-command per item. Dogfood: a real blocked run
   appears top of Inbox with a working approve action.
6. **Intervention bar + live-follow evidence timeline:** wire `<RunControls>` and
   the timeline to run-control + SSE. Dogfood: cancel a running attempt from the
   UI and watch the timeline update live.
7. **Parity conformance check:** land the operator-action manifest + test.
   Dogfood: CI fails if a new action lacks a CLI or UI binding.

## Honest boundary

This pillar makes the wedge *legible and operable*; it does not change
enforcement semantics. The blue accent, the Inbox, and the intervention controls
are how a human supervises governed runs — but the gates, evidence validation,
and C1-C7 constraints live in the runtime, not the UI. The UI must never imply it
*is* the enforcement (e.g. a UI "approve" is a recorded operator decision the
control plane acts on, not a client-side state flip).

## Key decisions (this pillar)

- **Dark-first brand retheme: flip :root to the near-black #111318 canvas and swap the orange #ff9d5c accent to signal-blue #2F6FED in both themes now, or defer.** — _Do it now, in step 2. The current Signal :root is a light editorial theme with an orange accent — it actively contradicts the brand book, and the swap is centralized in index.css + tokens.ts and bridged to shadcn, so it reskins both systems at once with near-zero component edits._. The brand-vs-shipped divergence is the single most visible defect (cream+orange vs near-black+blue). Because shadcn is bridged to the same --signal-* vars, the cost of doing it is one CSS file, but the cost of deferring is every new component built against the wrong palette. Low risk, high payoff.
- **Font swap: drop Geist for Inter + Archivo Expanded + JetBrains Mono now, or defer to a later pass.** — _Swap now alongside the retheme. Add Inter + Archivo Expanded fontsource packages at pinned exact versions with the mandatory >=7-day publish buffer; keep JetBrains Mono._. The inventory rates this DECIDE specifically because it is cheap (centralized in tokens.ts + index.css) and the divergence is from brand intent, not a defect. Bundling it with the retheme avoids a second visual-churn pass. Mono is load-bearing for the numerate/terminal feel, so getting the trio right early pays off in every IDs/states/latencies render.
- **Reconcile signal/ and ui/ into ONE system: collapse to a single Signal-led vocabulary, or keep shadcn as a co-equal layer.** — _Single token layer with CSS vars as the source of truth; keep shadcn PRIMITIVES (dialog/select/table) but demote them behind the bridge so there is one color/spacing vocabulary, not two. Do not rewrite the non-trivial Radix primitives._. The duplication (60 signal importers + 36 ui importers + literal class maps in stage-display.ts rendering side-by-side) is the headline smell. Rewriting Radix dialogs/selects/tables from scratch would be a greenfield mistake; bridging them to the unified vars gives one vocabulary at strangler cost. This satisfies the strangler mandate (rework REDESIGN, reuse REUSE).
- **Bakeoff comparison UI: keep it in the operator model or remove it.** — _Default KEEP but flag for operator confirmation. It is real and tested (bakeoff-dashboard.test.tsx) so it is not dead code; if multi-candidate compare is no longer an intended flow under the current model, it is a clean REMOVE._. Inventory rates it DECIDE/peripheral. It asks the operator to interpret raw candidate diffs (a legibility cost), and bakeoff itself is a DECIDE fork elsewhere in the inventory. This is a product call, not a UI call — surface it rather than silently keeping or cutting.
- **Where the needs-you Inbox lives: make Home the Inbox, or keep a separate /approvals + /repair + /activity split.** — _Make Home the Inbox spine (rename ProjectList.tsx -> Home.tsx) AND keep the dedicated Activity/Approvals/Repair pages as deep views. Home leads with the deduplicated cross-cutting needs-you queue; the dedicated pages are the focused work surfaces._. The D119 inbox principle and recent home/inbox prioritization commits already point this way. A single prioritized landing queue is what lets one operator supervise many runs (the autonomous goal); the dedicated pages remain for depth. This also fixes the ProjectList-is-actually-Home naming trap noted in the IA inventory.

**Dependencies:** Depends on: the shared control-plane Hono API (api-surface, KEEP) staying the single backend for both CLI and UI — the parity guarantee rides on it. The intervention controls depend on the run-control endpoints + SSE (D146 cancel/SSE work, already shipped). The cost strip depends on the cost-ledger pillar fixing silent-$0 Codex recording before the UI can show trustworthy per-run cost (until then the UI renders "unattributed", not "$0.00"). The evidence timeline + live-follow is the natural UI home for the evidence-cassette / proof-of-execution concept from the evidence/audit pillar — coordinate the timeline schema with that work. Unblocks: a brand-true, legible operator surface that makes the enforcement wedge demoable (the hosted-wedge story in CLAUDE.md — blocked decision, approval resolution, run-level evidence). The parity conformance check unblocks confidently adding new operator actions once. No SDK/schema dependency: this pillar is dashboard-local plus the existing API; it does NOT touch enforcement semantics or C1-C7.

**Risks:** 1) Retheme regressions: flipping :root to dark-default and swapping the accent could surface components that hardcode colors instead of using tokens (the stage-display.ts literal class maps are the known offender). De-risk: do the token-unification step (statusTone migration) BEFORE the visual flip, and grep for literal bg-/text- color classes and hex values across components first. 2) Font swap breaks layout: Archivo Expanded is wide and uppercase-only-display; misuse as body text would wreck density. De-risk: scope Archivo strictly to display/heading primitives via --font-display, keep Inter for body, JetBrains for machine values; verify the existing 40 component tests still render. 3) Deleting legacy routes breaks a deep-link someone relies on: /specs and /agents are reachable by URL. De-risk: repoint the two known inbound links first, keep RunRedirect-style graceful not-found, and grep the CLI for any printed /specs or /agents hrefs before deletion (thorough-search-on-renames rule). 4) Parity check false-confidence: a manifest can assert an endpoint+command+control exist without asserting they behave the same. De-risk: scope the conformance test to existence+identifier consistency (its real value), and document that semantic parity still rides on the shared API being the only backend. 5) Inbox over-aggregation: a poorly deduped Inbox could bury a real block under noise. De-risk: prioritize by attention/approval/dispatch exactly as the command palette already orders actions, and cap/age items. 6) Scope creep into a greenfield rewrite: the temptation is to rebuild the Radix primitives. De-risk: hold the strangler line — KEEP/REUSE-rated code is reskinned, never rewritten; only REDESIGN rows (stage-display maps, the dual-system reconciliation) are reworked.
