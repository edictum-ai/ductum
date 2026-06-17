# Dashboard — Components & Design System

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The dashboard has a real, working component library with broad test coverage (40 test files) and a deliberately-designed "Signal" token system layered over a shadcn/Radix base. The headline issue is design-system duplication: the bespoke `signal/` token+primitive system (60 importers) and the shadcn `ui/` system (36 importers) coexist, and the legacy Tailwind-class color maps in `lib/stage-display.ts` (STAGE_CLASSES etc.) are still imported alongside signal tokens in the same files (e.g. RunFeed.tsx), so two color vocabularies render side by side. There is genuine dead code: `TreeNavigator.tsx` (352 LOC, zero importers yet still carrying a D112 oversize grandfather exception) and `RelativeTime.tsx` (zero importers). Fonts ship as Geist + JetBrains Mono, which diverges from the brand book's Inter + Archivo Expanded + JetBrains Mono — a known input for the later UI pass. Legacy resource/Target vocabulary was largely cleaned (a repair test actively asserts its absence); remaining "resource"/"target" hits are legitimate current types, not the retired surfaces.

## Signal token + primitive design system
- **What:** Bespoke "Signal" editorial design language: CSS custom properties in `index.css` (`--signal-*`, light + dark) exposed as TS constants (`tokens.ts`) and composed by inline-style primitives (Caps, Num, Mono, Dot, Kbd, Card, CardHeader, Btn, Divider) plus layout/helpers.
- **Where:** components/signal/tokens.ts:12-72; components/signal/primitives.tsx:1-301; components/signal/layout.tsx (210 LOC); components/signal/helpers.ts (77 LOC); index.css:87-220
- **Maturity:** live-core
- **Quality:** solid — coherent token tiers, theme via `.dark` class only, agent/tone color helpers; primitives are small and consistent. Inline-style approach is intentional (avoids CSSOM read per render, documented in header).
- **Operator-legibility risk:** none — purely presentational.
- **Dependencies:** index.css CSS vars are source of truth; tokens.ts mirrors them; 60 files import from signal/.
- **Disposition (recommended):** KEEP — this is the current primary system and the foundation the later UI work builds on.
- **Flags:** Token `sans` stack is Geist, not the brand book's Inter/Archivo Expanded — see fonts entry. `agentColor()` hardcodes mimi/codex/glm/haiku agent ids (tokens.ts:49) which will drift if agent roster changes.

## shadcn / Radix ui/ component layer
- **What:** Standard shadcn-generated primitives (button, badge, card, dialog, input, select, table, tabs, tooltip, sheet, etc.) built on Radix + class-variance-authority + `cn()`, bridged to Signal via shadcn CSS-var aliases in index.css:120-155.
- **Where:** components/ui/*.tsx (16 files); bridged in index.css:120-138, 187-219; button.tsx:1-5 (cva/Radix)
- **Maturity:** live-core
- **Quality:** adequate — works and is theme-bridged, but it is a second styling vocabulary (Tailwind classes + cva variants) running parallel to Signal's inline-style primitives. badge(15)/button(14)/dialog(12)/card(9) are the heavily-used ones.
- **Operator-legibility risk:** none
- **Dependencies:** 36 files import ui/; depends on shadcn CSS-var bridge in index.css.
- **Disposition (recommended):** REUSE — keep the primitives (dialogs/selects/tables are non-trivial), but expect them to sit behind / be reconciled with Signal in the later UI pass rather than remaining a co-equal second system.
- **Flags:** legacy — design-system duplication with signal/ (two color/spacing vocabularies; see legacy section).

## Legacy Tailwind-class color maps (stage-display.ts)
- **What:** Hardcoded Tailwind utility-class strings for stage/spec/task/harness/evidence/gate/latch/tool colors, plus STAGE_LABEL ("Understanding"/"Implementing"/"Shipping"). Predates and parallels the Signal `toneColor`/`agentColor` token helpers.
- **Where:** lib/stage-display.ts:1-86; consumed by 7 non-test files; imported alongside signal tokens in the same file at components/homepage/RunFeed.tsx:15 (STAGE_CLASSES) + signal imports
- **Maturity:** live-peripheral
- **Quality:** fragile — these are exactly the "throwaway stage color maps" flagged in MEMORY (project-dashboard-shadcn-stages). They duplicate the Signal tone system with literal bg-cyan-100/dark: strings, and RunFeed.tsx renders both vocabularies at once. `opencode` harness color (line 53) references a harness slated for removal.
- **Operator-legibility risk:** none
- **Dependencies:** 7 components import STAGE_CLASSES/TASK_STATUS_CLASSES/etc.; WORKFLOW_STAGES const is also re-exported here.
- **Disposition (recommended):** REDESIGN — the capability (status→color) is needed, but the literal-class map duplicates Signal tones and should fold into the token system during the UI pass; the `opencode` entry should drop with harness cleanup.
- **Flags:** legacy/duplication; `opencode` color is dead-harness reference.

## Fonts: Geist + JetBrains Mono (vs brand book)
- **What:** App ships @fontsource-variable/geist + jetbrains-mono; Signal sans stack = Geist, mono = JetBrains Mono.
- **Where:** index.css:4-5, 42-44; tokens.ts:39-40
- **Maturity:** live-core
- **Quality:** adequate — loads and renders fine; the divergence is from brand intent, not a defect.
- **Operator-legibility risk:** none
- **Dependencies:** every Signal text primitive references tokens.sans/mono.
- **Disposition (recommended):** DECIDE — brand book calls for Inter + Archivo Expanded + JetBrains Mono; operator must decide whether to align now or defer to the later UI work (the swap is centralized in tokens.ts + index.css, so cheap).
- **Flags:** none (intentional divergence to record for the UI pass).

## Homepage / Today operator dashboard
- **What:** The primary operator landing surface: ActivityTimeline, RunFeed, SpecGroups, StageBar, HomepageTodayPanel + today-model, AwaitingBanner, LiveStreamCard, RecentDecisionsCard, ActiveSpecsCard, IntegrityIssueList, EmptyState.
- **Where:** components/homepage/ (12 files, 2121 LOC); HomepageTodayPanel used by pages/ProjectList.tsx; SpecGroups.tsx (469 LOC) + RunFeed.tsx (306 LOC) grandfathered in D112
- **Maturity:** live-core
- **Quality:** solid — cohesive, the model logic is split into homepage-today-model.ts, covered by tests. Two files exceed 300 LOC (grandfathered with explicit rationale, not abandoned).
- **Operator-legibility risk:** none — this surface exists specifically to make state legible.
- **Dependencies:** api/hooks, stage-display, signal primitives.
- **Disposition (recommended):** KEEP — core operator surface that fits the current Factory→…→Run model.
- **Flags:** SpecGroups.tsx/RunFeed.tsx are D112-grandfathered oversize (acceptable but tracked).

## Approval / repair / run-detail surfaces
- **What:** Approval queue cards + reject dialog + Telegram status + failure banner; repair overview/group sections; run CompletionSummary/FailureSummary/RunLineageTree; evidence TypedEvidenceRenderer.
- **Where:** components/approval/ (6 files, ApprovalCard.tsx 372 LOC grandfathered); components/repair/ (243 LOC); components/run/ (RunLineageTree 322 LOC grandfathered); components/evidence/TypedEvidenceRenderer.tsx (83 LOC)
- **Maturity:** live-core
- **Quality:** solid — these realize the wedge (approvals, blocked decisions, evidence, repair). repair.test.tsx:167 explicitly asserts retired vocab (Run/Target/Resources/seed) does NOT render, evidence the P7 rename was followed through here.
- **Operator-legibility risk:** none — typed/structured rendering, not raw logs.
- **Dependencies:** api types, signal primitives, stage-display.
- **Disposition (recommended):** KEEP — central to the hosted-wedge story and aligned with the current model.
- **Flags:** none.

## Settings panels (Factory Settings)
- **What:** Typed Factory Settings UI: FactorySettingsView/Panel, AgentSettingsPanel, RuntimeSettingsPanel, NotificationChannelsPanel, SecretsPanel, DashboardAccessPanel, AdvancedPanel, shared controls.tsx/value-utils.ts.
- **Where:** settings/ (10 files, 1823 LOC; largest NotificationChannelsPanel 283, SecretsPanel 214) — all under 300 LOC
- **Maturity:** live-core
- **Quality:** solid — built in P6 (per MEMORY), typed panels, covered by settings.test/settings-secrets/settings-auth tests; all files within size budget.
- **Operator-legibility risk:** partial — Secrets/Runtime panels expose raw refs (e.g. resourceRefs, model_* ids) the operator must map mentally, but they are form-driven not log-driven.
- **Dependencies:** api/client FactorySettings types; signal primitives.
- **Disposition (recommended):** KEEP — current source-of-truth surface for the Factory Settings model (Providers/Models/Harnesses/Workflows/Agents/notifications/budgets).
- **Flags:** none (the "resource" tokens here are legitimate notification-channel/agent-ref types, NOT the retired resource surface).

## Bakeoff comparison UI
- **What:** Candidate comparison surface: BakeoffComparePanel, BakeoffCandidateCard, BakeoffCandidateDiffGrid, CreateBakeoffDialog — multi-candidate diff/compare for picking among parallel attempts.
- **Where:** components/BakeoffComparePanel.tsx + 2 children; CreateBakeoffDialog used by pages/ProjectDetail.tsx; ComparePanel used by pages/SpecDetail.tsx
- **Maturity:** live-peripheral
- **Quality:** adequate — wired into pages and exercised by bakeoff-dashboard.test.tsx, but a peripheral/advanced flow rather than the core run loop.
- **Operator-legibility risk:** partial — diff-grid comparison asks the operator to interpret raw candidate diffs.
- **Dependencies:** api hooks, DiffViewer, signal primitives.
- **Disposition (recommended):** DECIDE — confirm bakeoff is still an intended operator workflow under the current model; if yes KEEP, if it was an experiment, it is a REMOVE candidate. It is real and tested, so not dead.
- **Flags:** none.

## Command palette + navigation chrome
- **What:** CommandPalette + command-palette-actions, Sidebar/SidebarSpend, Layout, TokenBanner, TaskDAG (React Flow), TreeNavigator.
- **Where:** components/CommandPalette.tsx + command-palette-actions.tsx (both via Layout.tsx); Sidebar.tsx/SidebarSpend.tsx; TaskDAG.tsx (319 LOC, via SpecGroups); TreeNavigator.tsx (352 LOC, ZERO importers)
- **Maturity:** live-peripheral (palette/sidebar live-core; TreeNavigator dead)
- **Quality:** adequate — palette was prioritized recently (commit 747fb51 "prioritize command palette actions"); TaskDAG works behind SpecGroups. TreeNavigator is dead weight.
- **Operator-legibility risk:** none
- **Dependencies:** Layout wires palette; TaskDAG depends on React Flow.
- **Disposition (recommended):** KEEP the palette/sidebar/TaskDAG; REMOVE TreeNavigator (see legacy section).
- **Flags:** TreeNavigator.tsx is unused yet holds a D112 oversize grandfather slot — delete to reclaim the exception.

## Dead utility component: RelativeTime
- **What:** Tooltip-wrapped relative-time span (timeAgo + absolute on hover).
- **Where:** components/RelativeTime.tsx (whole file); zero importers in src or tests
- **Maturity:** dead-unused
- **Quality:** adequate — the code itself is fine, it is simply unreferenced (timeAgo/formatAbsoluteTime are used directly elsewhere).
- **Operator-legibility risk:** none
- **Dependencies:** lib/utils, ui/tooltip — nothing imports it.
- **Disposition (recommended):** REMOVE — superseded by direct timeAgo usage; no consumers.
- **Flags:** dead-unused.
