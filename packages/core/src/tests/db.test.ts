import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import { initDb, inspectFactoryDatabase } from '../db.js'
import { resetDb } from '../db-reset.js'

const EXPECTED_TABLES = [
  'agents',
  'attempt_fence_sequence',
  'attempt_leases',
  'config_resources',
  'decisions',
  'edictum_session_counters',
  'edictum_session_values',
  'evidence',
  'factory_runtime_settings',
  'factory_secret_metadata',
  'factory_secret_payloads',
  'factory_view_state',
  'factories',
  'gate_evaluations',
  'components',
  'project_agents',
  'projects',
  'repositories',
  'run_checkpoints',
  'run_stage_history',
  'run_activity',
  'run_updates',
  'runs',
  'schema_migrations',
  'session_run_mapping',
  'spec_dependencies',
  'specs',
  'task_dependencies',
  'task_dispatch_skips',
  'tasks',
  'targets',
]

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('initDb', () => {
  it('creates all tables and is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-core-'))
    cleanup.push(dir)
    const dbPath = join(dir, 'ductum.sqlite')

    const db = initDb(dbPath)
    const dbAgain = initDb(dbPath)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tables).toEqual(expect.arrayContaining(EXPECTED_TABLES))
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 49 })
    expect(
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'evidence'").get(),
    ).toMatchObject({ sql: expect.stringContaining('exit_demo.run') })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('session_run_mapping') WHERE name = 'harness_session_id'").get(),
    ).toEqual({ name: 'harness_session_id' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('gate_evaluations') WHERE name = 'observed'").get(),
    ).toEqual({ name: 'observed' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('specs') WHERE name = 'max_fix_iterations'").get(),
    ).toEqual({ name: 'max_fix_iterations' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'required_role'").get(),
    ).toEqual({ name: 'required_role' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'retry_count'").get(),
    ).toEqual({ name: 'retry_count' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'retry_after'").get(),
    ).toEqual({ name: 'retry_after' })
    ;['working_dir', 'control_token', 'worker_pid', 'worker_ownership_kind'].forEach((name) => {
      expect(db.prepare(`SELECT name FROM pragma_table_info('session_run_mapping') WHERE name = '${name}'`).get()).toEqual({ name })
    })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'complexity'").get(),
    ).toEqual({ name: 'complexity' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'target_id'").get(),
    ).toEqual({ name: 'target_id' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'repository_id'").get(),
    ).toEqual({ name: 'repository_id' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'component_id'").get(),
    ).toEqual({ name: 'component_id' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('factory_view_state') WHERE name = 'home_last_seen_at'").get(),
    ).toEqual({ name: 'home_last_seen_at' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('specs') WHERE name = 'strategy'").get(),
    ).toEqual({ name: 'strategy' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'strategy_role'").get(),
    ).toEqual({ name: 'strategy_role' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'strategy_group'").get(),
    ).toEqual({ name: 'strategy_group' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'cost_tier'").get(),
    ).toEqual({ name: 'cost_tier' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'completion_summary'").get(),
    ).toEqual({ name: 'completion_summary' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'runtime_model'").get(),
    ).toEqual({ name: 'runtime_model' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'runtime_harness'").get(),
    ).toEqual({ name: 'runtime_harness' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'runtime_sandbox_profile'").get(),
    ).toEqual({ name: 'runtime_sandbox_profile' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'runtime_workflow_profile'").get(),
    ).toEqual({ name: 'runtime_workflow_profile' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'verify_retries'").get(),
    ).toEqual({ name: 'verify_retries' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'attempt_snapshot'").get(),
    ).toEqual({ name: 'attempt_snapshot' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('factory_runtime_settings') WHERE name = 'api_bind_host'").get(),
    ).toEqual({ name: 'api_bind_host' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('factory_secret_metadata') WHERE name = 'key_source_id'").get(),
    ).toEqual({ name: 'key_source_id' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('factory_secret_payloads') WHERE name = 'ciphertext'").get(),
    ).toEqual({ name: 'ciphertext' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'pricing'").get(),
    ).toEqual({ name: 'pricing' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'effort'").get(),
    ).toEqual({ name: 'effort' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'resource_refs'").get(),
    ).toEqual({ name: 'resource_refs' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'provider_id'").get(),
    ).toEqual({ name: 'provider_id' })
    expect(
      db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'account_id'").get(),
    ).toEqual({ name: 'account_id' })
    expect(() =>
      db.prepare(
        "INSERT INTO agents (id, name, model, harness, capabilities, spawn_config) VALUES ('future-agent', 'future', 'model-x', 'future-harness', '[]', '{}')",
      ).run(),
    ).not.toThrow()

    db.close()
    dbAgain.close()
  })

  it('enables WAL mode for file-backed databases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-core-'))
    cleanup.push(dir)
    const db = initDb(join(dir, 'ductum.sqlite'))

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
  })

  it('enables and enforces foreign keys', () => {
    const db = initDb(':memory:')

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(() =>
      db.prepare(
        "INSERT INTO projects (id, factory_id, name, repos, config) VALUES ('p1', 'missing', 'proj', '[]', '{}')",
      ).run(),
    ).toThrow(/FOREIGN KEY/)

    db.close()
  })

  it('replays missing migration records without duplicate schema errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-core-'))
    cleanup.push(dir)
    const dbPath = join(dir, 'ductum.sqlite')

    const db = initDb(dbPath)
    db.prepare(
      "DELETE FROM schema_migrations WHERE id IN ('002_run_updates', '003_tasks_required_role', '004_run_activity', '005_task_retry', '006_session_run_working_dir', '007_session_run_control_token', '008_workflow_stages')",
    ).run()
    db.close()

    expect(() => {
      const reopened = initDb(dbPath)
      reopened.close()
    }).not.toThrow()
  })

  it('preserves runs, activity, and evidence across restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-core-'))
    cleanup.push(dir)
    const dbPath = join(dir, 'ductum.sqlite')

    const db = initDb(dbPath)
    seedRunData(db)
    db.close()

    const reopened = initDb(dbPath)
    expect(
      reopened.prepare('SELECT id, stage, session_id FROM runs WHERE id = ?').get('run-1'),
    ).toEqual({ id: 'run-1', stage: 'implement', session_id: 'session-1' })
    expect(
      reopened.prepare('SELECT kind, content FROM run_activity WHERE run_id = ?').all('run-1'),
    ).toEqual([{ kind: 'tool_call', content: 'Read README.md' }])
    expect(
      reopened.prepare('SELECT type, payload FROM evidence WHERE run_id = ?').all('run-1'),
    ).toEqual([{ type: 'test', payload: '{"passed":true}' }])
    reopened.close()
  })

  it('resetDb wipes file-backed databases only when explicitly called', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-core-'))
    cleanup.push(dir)
    const dbPath = join(dir, 'ductum.sqlite')

    const db = initDb(dbPath)
    seedRunData(db)
    db.close()

    resetDb(dbPath)

    const reopened = initDb(dbPath)
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM run_activity').get()).toEqual({
      count: 0,
    })
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM evidence').get()).toEqual({ count: 0 })
    reopened.close()
  })

  it('inspects factory presence without creating or migrating a database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-core-inspect-'))
    cleanup.push(dir)
    const missingPath = join(dir, 'missing.sqlite')

    expect(inspectFactoryDatabase(missingPath)).toEqual({ state: 'missing', path: missingPath })
    expect(existsSync(missingPath)).toBe(false)

    const dbPath = join(dir, 'ductum.sqlite')
    const db = initDb(dbPath)
    expect(inspectFactoryDatabase(dbPath)).toEqual({ state: 'empty', path: dbPath })
    db.prepare("INSERT INTO factories (id, name, config) VALUES ('factory-1', 'Ductum', '{}')").run()
    expect(inspectFactoryDatabase(dbPath)).toEqual({ state: 'has_factory', path: dbPath })
    db.close()
  })
})

function seedRunData(db: ReturnType<typeof initDb>): void {
  db.prepare("INSERT INTO factories (id, name, config) VALUES ('factory-1', 'Ductum', '{}')").run()
  db.prepare(
    "INSERT INTO agents (id, name, model, harness, capabilities, spawn_config) VALUES ('agent-1', 'mimi', 'claude-opus-4-6', 'claude-agent-sdk', '[]', '{}')",
  ).run()
  db.prepare(
    "INSERT INTO projects (id, factory_id, name, repos, config) VALUES ('project-1', 'factory-1', 'ductum', '[]', '{}')",
  ).run()
  db.prepare(
    "INSERT INTO specs (id, project_id, name, status, document) VALUES ('spec-1', 'project-1', 'P1', 'approved', '# P1')",
  ).run()
  db.prepare(
    "INSERT INTO tasks (id, spec_id, name, prompt, status, verification) VALUES ('task-1', 'spec-1', 'Task 1', 'implement P1', 'active', '[]')",
  ).run()
  db.prepare(
    "INSERT INTO runs (id, task_id, agent_id, stage, session_id) VALUES ('run-1', 'task-1', 'agent-1', 'implement', 'session-1')",
  ).run()
  db.prepare(
    "INSERT INTO run_activity (run_id, kind, content) VALUES ('run-1', 'tool_call', 'Read README.md')",
  ).run()
  db.prepare(
    "INSERT INTO evidence (id, run_id, type, payload) VALUES ('evidence-1', 'run-1', 'test', '{\"passed\":true}')",
  ).run()
}
