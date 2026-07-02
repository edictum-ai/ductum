import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'

import { Layout } from './components/Layout'
import { LazyRouteOutlet } from './routes/LazyRouteOutlet'

const HomePage = lazy(() =>
  import('./pages/Home').then((module) => ({ default: module.Home })),
)
const ProjectsPage = lazy(() =>
  import('./pages/Projects').then((module) => ({ default: module.Projects })),
)
const FactoryActivityPage = lazy(() =>
  import('./pages/FactoryActivity').then((module) => ({ default: module.FactoryActivity })),
)
const AnalyticsPage = lazy(() =>
  import('./pages/Analytics').then((module) => ({ default: module.Analytics })),
)
const RepairPage = lazy(() =>
  import('./pages/Repair').then((module) => ({ default: module.Repair })),
)
const ApprovalQueuePage = lazy(() =>
  import('./pages/ApprovalQueue').then((module) => ({ default: module.ApprovalQueue })),
)
const AuditLogPage = lazy(() =>
  import('./pages/AuditLog').then((module) => ({ default: module.AuditLog })),
)
const OpsHealthPage = lazy(() =>
  import('./pages/OpsHealth').then((module) => ({ default: module.OpsHealth })),
)
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((module) => ({ default: module.Settings })),
)
const WelcomePage = lazy(() =>
  import('./pages/Welcome').then((module) => ({ default: module.Welcome })),
)
const ProjectDetailPage = lazy(() =>
  import('./pages/ProjectDetail').then((module) => ({ default: module.ProjectDetail })),
)
const SpecDetailPage = lazy(() =>
  import('./pages/SpecDetail').then((module) => ({ default: module.SpecDetail })),
)
const TaskDetailPage = lazy(() =>
  import('./pages/TaskDetail').then((module) => ({ default: module.TaskDetail })),
)
const RunDetailPage = lazy(() =>
  import('./pages/RunDetail').then((module) => ({ default: module.RunDetail })),
)
const RunRedirectPage = lazy(() =>
  import('./pages/RunRedirect').then((module) => ({ default: module.RunRedirect })),
)

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route element={<LazyRouteOutlet />}>
          <Route path="/" element={<HomePage />} />
          {/* Static routes must come before slug-based routes */}
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/activity" element={<FactoryActivityPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/ops-health" element={<OpsHealthPage />} />
          <Route path="/repair" element={<RepairPage />} />
          <Route path="/approvals" element={<ApprovalQueuePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          {/* Deep-link redirect: /runs/<fullRunId> → canonical slug path */}
          <Route path="/runs/:runId" element={<RunRedirectPage />} />
          {/* Slug-based routes */}
          <Route path="/:project" element={<ProjectDetailPage />} />
          <Route path="/:project/:spec" element={<SpecDetailPage />} />
          <Route path="/:project/:spec/:task" element={<TaskDetailPage />} />
          <Route path="/:project/:spec/:task/:runId" element={<RunDetailPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
