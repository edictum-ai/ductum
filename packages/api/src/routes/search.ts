import type { Hono } from 'hono'
import { redactPublicText, shortId } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { publicOutput } from '../lib/public-output.js'

export interface SearchResult {
  type: 'run' | 'task' | 'spec' | 'project' | 'agent' | 'decision'
  id: string
  name: string
  subtitle?: string
  url: string
}

interface ScoredResult extends SearchResult {
  score: number
}

const TYPE_PRIORITY: Record<SearchResult['type'], number> = {
  project: 5,
  spec: 4,
  task: 3,
  run: 2,
  decision: 1,
  agent: 0,
}

function scoreName(name: string, q: string): number {
  const lname = name.toLowerCase()
  const lq = q.toLowerCase()
  if (lname === lq) return 3
  if (lname.startsWith(lq)) return 2
  return 1
}

function queryTerms(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean)
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function likeFilter(columns: string[], terms: string[]): { where: string; params: string[] } {
  const haystack = columns.map((col) => `LOWER(COALESCE(${col}, ''))`).join(" || ' ' || ")
  return {
    where: terms.map(() => `${haystack} LIKE ? ESCAPE '\\'`).join(' AND '),
    params: terms.map((term) => `%${escapeLike(term)}%`),
  }
}

function enc(s: string): string {
  return encodeURIComponent(s)
}

function hasRedactionMarker(value: string | null | undefined): boolean {
  return /\[redacted\]/i.test(value ?? '')
}

function hasSensitivePublicText(value: string | null | undefined): boolean {
  const text = value?.trim()
  return text != null && text !== '' && redactPublicText(text) !== text
}

function needsSafeFallback(value: string | null | undefined): boolean {
  return hasRedactionMarker(value) || hasSensitivePublicText(value)
}

function displayStoredName(value: string, fallback: string): string {
  return needsSafeFallback(value) || value.trim() === '' ? fallback : value
}

function routeSegment(value: string, fallbackId: string): string {
  return needsSafeFallback(value) ? fallbackId : value
}

export function registerSearchRoutes(app: Hono, context: ApiContext) {
  app.get('/api/search', (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (q === '') return c.json(publicOutput([] as SearchResult[]))

    const terms = queryTerms(q)
    const results: ScoredResult[] = []

    const projectFilter = likeFilter(['name'], terms)
    const projects = context.db
      .prepare(`SELECT id, name FROM projects WHERE ${projectFilter.where}`)
      .all(...projectFilter.params) as Array<{ id: string; name: string }>
    for (const p of projects) {
      results.push({ type: 'project', id: p.id, name: p.name, subtitle: 'Project', url: `/${enc(p.name)}`, score: scoreName(p.name, q) })
    }

    const specFilter = likeFilter(['s.name', 'p.name', 's.status'], terms)
    const specs = context.db
      .prepare(
        `SELECT s.id AS id, s.name AS name, p.name AS project_name FROM specs s JOIN projects p ON p.id = s.project_id WHERE ${specFilter.where}`,
      )
      .all(...specFilter.params) as Array<{ id: string; name: string; project_name: string }>
    for (const s of specs) {
      const specName = displayStoredName(s.name, `Spec ${shortId(s.id)}`)
      results.push({
        type: 'spec',
        id: s.id,
        name: specName,
        subtitle: s.project_name,
        url: `/${enc(s.project_name)}/${enc(routeSegment(s.name, s.id))}`,
        score: scoreName(specName, q),
      })
    }

    const taskFilter = likeFilter(['t.name', 't.status', 's.name', 'p.name'], terms)
    const tasks = context.db
      .prepare(
        `SELECT t.id AS id, t.name AS name, s.id AS spec_id, s.name AS spec_name, p.name AS project_name FROM tasks t JOIN specs s ON s.id = t.spec_id JOIN projects p ON p.id = s.project_id WHERE ${taskFilter.where}`,
      )
      .all(...taskFilter.params) as Array<{ id: string; name: string; spec_id: string; spec_name: string; project_name: string }>
    for (const t of tasks) {
      const taskName = displayStoredName(t.name, `Task ${shortId(t.id)}`)
      const specName = displayStoredName(t.spec_name, `Spec ${shortId(t.spec_id)}`)
      results.push({
        type: 'task',
        id: t.id,
        name: taskName,
        subtitle: `${t.project_name} · ${specName}`,
        url: `/${enc(t.project_name)}/${enc(routeSegment(t.spec_name, t.spec_id))}/${enc(routeSegment(t.name, t.id))}`,
        score: scoreName(taskName, q),
      })
    }

    const runFilter = likeFilter(['r.id', 'r.stage', 't.name', 's.name', 'p.name', 'a.name', 'a.model'], terms)
    const runs = context.db
      .prepare(
        `
          SELECT r.id AS id, t.id AS task_id, t.name AS task_name, s.id AS spec_id, s.name AS spec_name, p.name AS project_name
          FROM runs r
          JOIN tasks t ON t.id = r.task_id
          JOIN specs s ON s.id = t.spec_id
          JOIN projects p ON p.id = s.project_id
          LEFT JOIN agents a ON a.id = r.agent_id
          WHERE ${runFilter.where}
        `,
      )
      .all(...runFilter.params) as Array<{ id: string; task_id: string; task_name: string; spec_id: string; spec_name: string; project_name: string }>
    for (const r of runs) {
      const short = r.id.slice(0, 6)
      const taskName = displayStoredName(r.task_name, `Task ${shortId(r.task_id)}`)
      const specName = displayStoredName(r.spec_name, `Spec ${shortId(r.spec_id)}`)
      results.push({
        type: 'run',
        id: r.id,
        name: `${taskName} (${short})`,
        subtitle: `${r.project_name} · ${specName}`,
        url: `/${enc(r.project_name)}/${enc(routeSegment(r.spec_name, r.spec_id))}/${enc(routeSegment(r.task_name, r.task_id))}/${short}`,
        score: q.length >= 4 && r.id.startsWith(q) ? 3 : 2,
      })
    }

    const decisionFilter = likeFilter(['d.decision', 'd.context'], terms)
    const decisions = context.db
      .prepare(
        `
          SELECT
            d.id AS id,
            d.decision AS decision,
            COALESCE(d.context, '') AS context,
            COALESCE(s_direct.id, s_task.id, s_run.id) AS spec_id,
            COALESCE(s_direct.name, s_task.name, s_run.name) AS spec_name,
            COALESCE(p_direct.name, p_task.name, p_run.name) AS project_name,
            COALESCE(t_direct.id, t_run.id) AS task_id,
            COALESCE(t_direct.name, t_run.name) AS task_name,
            r.id AS run_id
          FROM decisions d
          LEFT JOIN specs s_direct ON s_direct.id = d.spec_id
          LEFT JOIN projects p_direct ON p_direct.id = s_direct.project_id
          LEFT JOIN tasks t_direct ON t_direct.id = d.task_id
          LEFT JOIN specs s_task ON s_task.id = t_direct.spec_id
          LEFT JOIN projects p_task ON p_task.id = s_task.project_id
          LEFT JOIN runs r ON r.id = d.run_id
          LEFT JOIN tasks t_run ON t_run.id = r.task_id
          LEFT JOIN specs s_run ON s_run.id = t_run.spec_id
          LEFT JOIN projects p_run ON p_run.id = s_run.project_id
          WHERE ${decisionFilter.where}
        `,
      )
      .all(...decisionFilter.params) as Array<{
        id: string
        decision: string
        context: string
        spec_id: string | null
        spec_name: string | null
        project_name: string | null
        task_id: string | null
        task_name: string | null
        run_id: string | null
      }>
    for (const d of decisions) {
      const project = d.project_name
      const spec = d.spec_name
      const task = d.task_name
      const shortRun = d.run_id?.slice(0, 6) ?? null
      const specSegment = spec != null && d.spec_id != null ? routeSegment(spec, d.spec_id) : null
      const taskSegment = task != null && d.task_id != null ? routeSegment(task, d.task_id) : null
      const safeSpec = spec != null && d.spec_id != null ? displayStoredName(spec, `Spec ${shortId(d.spec_id)}`) : null
      const safeTask = task != null && d.task_id != null ? displayStoredName(task, `Task ${shortId(d.task_id)}`) : null
      const url = project != null && specSegment != null && taskSegment != null && shortRun != null
        ? `/${enc(project)}/${enc(specSegment)}/${enc(taskSegment)}/${shortRun}`
        : project != null && spec != null && task != null
          ? `/${enc(project)}/${enc(specSegment ?? spec)}/${enc(taskSegment ?? task)}`
          : project != null && specSegment != null
            ? `/${enc(project)}/${enc(specSegment)}`
            : '/'
      results.push({
        type: 'decision',
        id: d.id,
        name: displayStoredName(d.decision, `Decision ${shortId(d.id)}`),
        subtitle: [project, safeSpec, safeTask].filter(Boolean).join(' · ') || displayStoredName(d.context.slice(0, 80), 'Decision context'),
        url,
        score: scoreName(d.decision, q),
      })
    }

    const agentFilter = likeFilter(['name', 'model', 'harness'], terms)
    const agents = context.db
      .prepare(`SELECT id, name, model FROM agents WHERE ${agentFilter.where}`)
      .all(...agentFilter.params) as Array<{ id: string; name: string; model: string }>
    for (const a of agents) {
      results.push({ type: 'agent', id: a.id, name: a.name, subtitle: a.model, url: '/agents', score: scoreName(a.name, q) })
    }

    results.sort((a, b) => b.score - a.score || TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type])
    const out: SearchResult[] = results.slice(0, 10).map(({ score: _s, ...rest }) => rest)
    return c.json(publicOutput(out))
  })
}
