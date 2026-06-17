# Dashboard — Information Architecture

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The dashboard routing shell (App.tsx + Layout + lazy outlet) is solid, lazy-loaded, and matches the current Project -> Spec -> Task -> Attempt slug hierarchy. The live navigation is a clean six-item static Sidebar. However, the IA carries real legacy debt: a 15KB TreeNavigator left rail that is fully dead (zero imports), two routes the codebase itself labels "Legacy" in breadcrumbs (/specs SpecList and /agents AgentList) that survive only as deep-links, and confusingly-named page modules (ProjectList is actually the homepage; Projects is the index). A post-delete redirect in SpecDetail still drops the operator on the legacy SpecList page. None of this is broken, but the legacy surfaces are exactly the "not deleted" debt the operator flagged.

## Routing shell & route table
- **What:** Central `Routes` declaration with lazy-loaded pages, static routes ordered before slug routes, and the canonical 4-segment attempt path `/:project/:spec/:task/:runId`. `main.tsx` mounts BrowserRouter + react-query + tooltip + theme bootstrap.
- **Where:** `packages/dashboard/src/App.tsx:50-76`, `main.tsx:1-33`, `routes/LazyRouteOutlet.tsx:6-12`, `routes/RouteLoading.tsx`
- **Maturity:** live-core
- **Quality:** solid — clean code-split, explicit comment that static routes precede slug routes, single Suspense boundary with a loading fallback.
- **Operator-legibility risk:** none — URL hierarchy mirrors the operator model exactly.
- **Dependencies:** react-router-dom v6 `Routes`/`Route`; every page module; Layout outlet.
- **Disposition (recommended):** KEEP — correct shape for the current primitive model.
- **Flags:** none

## App shell / Layout (sidebar + topbar + breadcrumbs)
- **What:** Responsive shell: desktop sidebar + breadcrumb topbar + SSE connection dot + command-palette button; mobile sheet nav. `crumbsFor()` derives breadcrumbs from the pathname.
- **Where:** `components/Layout.tsx:21-258` (`crumbsFor` 21-63, `TopBar` 82-201, `Layout` 203-258)
- **Maturity:** live-core
- **Quality:** solid — breadcrumb derivation is pure/synchronous off slugs; SSE status and TokenBanner wired in; mobile/desktop split via media query.
- **Operator-legibility risk:** partial — `crumbsFor` itself emits "Legacy specs" / "Legacy agents" crumbs (lines 34-40), so legacy pages are still given a navigable breadcrumb trail, mildly legitimizing retired surfaces.
- **Dependencies:** `useDuctumSSE`, Sidebar, CommandPalette, TokenBanner.
- **Disposition (recommended):** KEEP — but drop the "Legacy specs/agents" crumb arms when those routes are removed.
- **Flags:** legacy — hardcoded "Legacy specs"/"Legacy agents" breadcrumb cases (`Layout.tsx:34-40`) keep retired routes reachable.

## Primary navigation (Sidebar + SidebarSpend)
- **What:** The live left-rail nav: six items (Home, Projects, Factory Activity, Approvals, Factory Settings, Repair) with live count badges and a WeekPulse spend strip; mirrored into the mobile sheet.
- **Where:** `components/Sidebar.tsx:13-281` (NAV_ITEMS 13-20, `currentNavId` 45-56, `navBadge` 191-201), `components/SidebarSpend.tsx:12` (`WeekPulse`)
- **Maturity:** live-core
- **Quality:** solid — badges driven by real brief/repair/approval queries; WeekPulse is the only consumer of SidebarSpend and is correctly imported.
- **Operator-legibility risk:** partial — `currentNavId` maps `/specs`→projects and `/agents`→settings (lines 53-54), i.e. the nav silently absorbs two legacy routes that have no nav entry, so an operator on those pages sees an active item that does not correspond to where they are.
- **Dependencies:** `useAllRuns`, `useOperatorBrief`, `useRepairReport`; theme.
- **Disposition (recommended):** KEEP — this is the canonical nav; the static link list won over TreeNavigator.
- **Flags:** legacy — `currentNavId` still special-cases `/specs` and `/agents` (Sidebar.tsx:53-54).

## TreeNavigator (dead left-rail tree)
- **What:** A 15KB persistent project→spec→lineage tree navigator whose own header docstring says it "Replaces the static 'Factory / Agents / Approvals' link list."
- **Where:** `components/TreeNavigator.tsx:1-380` (header comment 1-19, `/agents` nav 326-336)
- **Maturity:** dead-unused
- **Quality:** adequate — internally coherent, but verified zero imports anywhere in src or tests (`grep TreeNavigator` returns only the file itself).
- **Operator-legibility risk:** none — never rendered.
- **Dependencies:** none inbound; would depend on `useAllRuns`/`useProjects` if mounted.
- **Disposition (recommended):** REMOVE — superseded by the static Sidebar; it is the "replacement" that never replaced anything and still hardcodes a `/agents` jump.
- **Flags:** legacy/dead — unreferenced, contradicts shipped nav, still routes to the retired `/agents` page.

## Home dashboard (ProjectList page)
- **What:** The `/` route. Despite the filename it is the operator HOME/today dashboard: Today panel, awaiting-approval banner, active-specs, recent-decisions, live-stream cards, plus legacy home-last-seen localStorage→DB migration.
- **Where:** `pages/ProjectList.tsx:17-122` (legacy last-seen migration 26-65), wired at `App.tsx:55`
- **Maturity:** live-core
- **Quality:** adequate — functional, but the module name `ProjectList` describes neither its route (`/`) nor its content (home), an IA naming trap; the localStorage migration effect adds complexity.
- **Operator-legibility risk:** partial — naming only; the rendered page is legible.
- **Dependencies:** homepage/* cards, `useOperatorBrief`, `useExecutionIntegrity`, `useFactoryHomeViewState`.
- **Disposition (recommended):** REUSE — keep the page; the file name (ProjectList) is misleading vs. the `Projects` index and should be reconciled.
- **Flags:** legacy — carries a localStorage `homeLastSeen` migration path (lines 26-65) that is one-time-migration debt; name collision with `Projects.tsx`.

## Projects index (Projects page)
- **What:** The `/projects` route: the real project grid with per-project attention/approval/running/clean-done signal rollups and effective cost-per-clean-done.
- **Where:** `pages/Projects.tsx:28-170` (`buildProjectSummaries` 127-154), wired at `App.tsx:57`
- **Maturity:** live-core
- **Quality:** solid — uses the signal design system, fans out spec/task counts per card, sensible priority sort.
- **Operator-legibility risk:** none — clean cards; status derived, not raw.
- **Dependencies:** `useProjects`, `useAllRuns`, `useSpecs`, `useProjectTasks`, CreateProjectDialog.
- **Disposition (recommended):** KEEP — correct project index for the current model. (Pairs with the ProjectList naming cleanup above.)
- **Flags:** none

## Detail hierarchy (ProjectDetail / SpecDetail / TaskDetail / RunDetail)
- **What:** The four slug-driven drilldown pages forming Project→Spec→Task→Attempt; RunDetail composes a tabbed attempt view (activity/evidence/transitions/gates/decisions/updates) under `pages/run-detail/*`.
- **Where:** `pages/ProjectDetail.tsx`, `pages/SpecDetail.tsx` (22KB), `pages/TaskDetail.tsx`, `pages/RunDetail.tsx`, `pages/run-detail/detail-tabs.tsx:7-64`; routes `App.tsx:68-71`
- **Maturity:** live-core
- **Quality:** adequate — wiring and navigation are correct (create-spec/rename navigate to canonical slug paths); SpecDetail is 22KB and dense.
- **Operator-legibility risk:** none — tabs label and count evidence/gates/decisions in plain terms.
- **Dependencies:** `useResolveTask`/`useRuns`/`useSpecs`; run-detail sub-panels; signal + shadcn ui.
- **Disposition (recommended):** KEEP — core drilldown matches the operator model.
- **Flags:** bug — after deleting a spec, `SpecDetail.tsx:361` navigates to `/specs` (the legacy SpecList) instead of back to `/:project`, dropping the operator onto a retired page.

## Operator action pages (FactoryActivity / ApprovalQueue / Repair)
- **What:** Cross-project work surfaces: Factory Activity (ready-to-dispatch + needs-operator + running sections), Approvals queue, and Repair (factory blocker/attention list grouped by area).
- **Where:** `pages/FactoryActivity.tsx:17+`, `pages/ApprovalQueue.tsx`, `pages/Repair.tsx:10-21+`; routes `App.tsx:58-61`
- **Maturity:** live-core
- **Quality:** solid — all in the nav with live badges; Repair adapts typed `ApiRepairGroup`/`ApiRepairItem` into view models.
- **Operator-legibility risk:** none — these are the legibility surfaces (sections, severities, named next actions).
- **Dependencies:** `useAllRuns`, `useOperatorBrief`, `useRepairReport`; activity/* and repair/* components.
- **Disposition (recommended):** KEEP — direct expression of the operator/HITL wedge.
- **Flags:** none

## Factory Settings page
- **What:** `/settings` aggregate Factory Settings on typed DB/runtime APIs (access, factory, runtime, secrets, agents, view, advanced); auth-probe fallback to a "Connect API access" panel.
- **Where:** `pages/Settings.tsx:20-86`; route `App.tsx:62`
- **Maturity:** live-core
- **Quality:** solid — docstring explicitly states "No YAML, no raw config editor" (post-P6/P3 typed-settings rebuild); each panel owns its typed read/write.
- **Operator-legibility risk:** none — typed panels, no raw state editing.
- **Dependencies:** `useFactorySettings`; settings/* panels; RegisterAgentDialog.
- **Disposition (recommended):** KEEP — aligns with DB-as-truth and ductum.yaml demotion.
- **Flags:** none

## Legacy SpecList (/specs) & AgentList (/agents)
- **What:** Two standalone index pages reachable only by URL: a global spec list and a workforce/agent list. Both are explicitly tagged "Legacy specs"/"Legacy agents" by the breadcrumb layer and are absent from the Sidebar.
- **Where:** `pages/SpecList.tsx:27+`, `pages/AgentList.tsx:15-113`; routes `App.tsx:60,63`; legacy crumbs `Layout.tsx:34-40`; entry links remain in `Welcome.tsx:144` (→/specs) and `SpecDetail.tsx:361` (→/specs)
- **Maturity:** legacy-retired
- **Quality:** adequate — code runs, but functionally superseded (specs live under ProjectDetail/SpecDetail; agents live under Factory Settings; AgentList's only CTA is a "Factory Settings" button).
- **Operator-legibility risk:** partial — present a second, parallel IA for specs/agents that diverges from the canonical project-scoped and settings-scoped paths.
- **Dependencies:** specs/* and agents/AgentWorkforce components; inbound deep-links from Welcome and SpecDetail-delete.
- **Disposition (recommended):** REMOVE — retired-but-undeleted; first repoint the two inbound links (Welcome, SpecDetail post-delete) to project-scoped paths.
- **Flags:** legacy — self-labeled "Legacy" in breadcrumbs, off-nav, but kept alive by two stale internal links.

## Welcome / first-run handoff (/welcome)
- **What:** Off-nav onboarding page that exchanges a `?token=` handoff to bind the browser session, then shows factory/projects/agents/sample-spec setup state.
- **Where:** `pages/Welcome.tsx:12-60+`; route `App.tsx:64`; api `client.ts:597-599`
- **Maturity:** live-peripheral
- **Quality:** adequate — guarded token exchange with `exchangedRef`, query-string stripping, and a clear expiry message; but links onward to legacy `/specs` (line 144).
- **Operator-legibility risk:** none — purpose-built onboarding copy.
- **Dependencies:** `exchangeWelcomeHandoff`/`getWelcomeSampleSpec`; ImportSpecDialog.
- **Disposition (recommended):** REUSE — keep the onboarding flow but repoint its `/specs` link to a project-scoped or activity destination.
- **Flags:** legacy — onward link to retired `/specs` (Welcome.tsx:144).

## RunRedirect (legacy deep-link resolver)
- **What:** Resolves CLI-printed `/runs/<fullRunId>` links to the canonical `/<project>/<spec>/<task>/<shortRunId>` path, with a focused "Attempt not found" fallback.
- **Where:** `pages/RunRedirect.tsx:15-49`; route `App.tsx:66`
- **Maturity:** live-peripheral
- **Quality:** solid — single-purpose, `retry:false`, distinct not-found UI to avoid a misleading "Spec could not be resolved" error.
- **Operator-legibility risk:** none.
- **Dependencies:** `api.resolveRunById`; shortId.
- **Disposition (recommended):** KEEP — this is a deliberate compatibility shim for CLI output, not stale code.
- **Flags:** none

## Command palette (search + operator actions)
- **What:** Cmd/Ctrl-K palette merging server search results (projects/specs/tasks/attempts/decisions/agents) with prioritized operator actions (inspect blocked, review approval, dispatch, watch, repair, open activity, connect API).
- **Where:** `components/CommandPalette.tsx:11-174`, `components/command-palette-actions.tsx:32-153`
- **Maturity:** live-core
- **Quality:** solid — debounced search, keyboard nav, action ordering by attention/approval/dispatch; actions deep-link to canonical run hrefs and `/activity`, `/repair`, `/settings#api-access` (none point at legacy /specs or /agents).
- **Operator-legibility risk:** none — actions are named next steps, not raw state.
- **Dependencies:** `useSearch`, `useAllRuns`, `useOperatorBrief`, `useRepairReport`, `buildRunSections`.
- **Disposition (recommended):** KEEP — strongest cross-IA jump surface and already aligned to the current model.
- **Flags:** none

## Legacy / dead-but-not-deleted in this domain
- `components/TreeNavigator.tsx` — 15KB alternate left-rail tree, ZERO imports in src or tests; its docstring claims to replace the static link list but the static Sidebar shipped instead. Pure dead code; still hardcodes a `/agents` jump.
- `pages/SpecList.tsx` (route `/specs`) — self-labeled "Legacy specs" in `Layout.tsx:34-36`, removed from nav; superseded by project-scoped SpecDetail. Kept alive only by `Welcome.tsx:144` and the `SpecDetail.tsx:361` post-delete redirect.
- `pages/AgentList.tsx` (route `/agents`) — self-labeled "Legacy agents" in `Layout.tsx:40`, off-nav; superseded by Factory Settings (its own primary CTA is "Factory Settings"). TreeNavigator is its only remaining internal linker, and TreeNavigator is itself dead.
- `Layout.tsx:34-40` — "Legacy specs"/"Legacy agents" breadcrumb arms and `Sidebar.tsx:53-54` `currentNavId` special-cases that exist solely to accommodate the two legacy routes.
- `pages/ProjectList.tsx:26-65` — one-time localStorage `homeLastSeen`→DB migration path; migration debt, not steady-state code.
- Naming collision: `ProjectList.tsx` is the HOME page while `Projects.tsx` is the project index — an IA naming trap, not dead code, but a source of operator/dev confusion.
