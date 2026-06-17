import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * DB-only Factory seeding for repo-local scripts (bootstrap + demos).
 *
 * This is the script-side mirror of what `ductum init` does: write the
 * local `.ductum/secrets.key`, open the Factory DB, and seed the initial
 * Factory/Project/Repository/Component/Agents in SQLite. No ductum.yaml.
 */

/**
 * Create `<factoryDir>/.ductum/secrets.key` (0600) if it does not exist.
 * Matches D170: the key file is the local secret-key source, never SQLite.
 */
export function ensureFactorySecretKey(factoryDir) {
  const keyPath = join(factoryDir, '.ductum', 'secrets.key')
  if (existsSync(keyPath)) return { keyPath, created: false }
  mkdirSync(dirname(keyPath), { recursive: true })
  writeFileSync(keyPath, randomBytes(32), { mode: 0o600 })
  try {
    chmodSync(keyPath, 0o600)
  } catch {
    // Best effort; seeding should not fail only because chmod is unavailable.
  }
  return { keyPath, created: true }
}

/**
 * Map resolved bootstrap providers to the seedable agent providers that
 * `seedInitialFactoryDatabase` understands. OpenAI maps to the Codex agent
 * (Codex auths via the OpenAI credential); zai/openrouter have no built-in
 * seed agent yet and are dropped.
 */
export function seedAgentProviders(resolvedProviders) {
  const seen = new Set()
  const agents = []
  for (const provider of resolvedProviders) {
    const mapped = mapProvider(provider?.provider)
    if (mapped == null || seen.has(mapped)) continue
    seen.add(mapped)
    agents.push(mapped)
  }
  return agents
}

function mapProvider(provider) {
  if (provider === 'anthropic') return 'anthropic'
  if (provider === 'copilot') return 'copilot'
  if (provider === 'openai') return 'codex'
  return null
}

/**
 * Seed a fresh DB-only Factory. Throws if the DB already holds a Factory so
 * bootstrap never silently re-seeds over operator state.
 *
 * @returns the InitialFactorySeedResult from @ductum/core.
 */
export async function seedFactoryDatabase({ dbPath, factoryDir, projectName, agents, workflowProfilePath }) {
  const { initDb, seedInitialFactoryDatabase, SqliteConfigResourceRepo } = await import('../packages/core/dist/index.js')
  ensureFactorySecretKey(factoryDir)
  const db = initDb(dbPath)
  try {
    const seed = seedInitialFactoryDatabase({
      db,
      factoryDir,
      projectName,
      agents: agents ?? [],
    })
    if (typeof workflowProfilePath === 'string' && workflowProfilePath.trim() !== '') {
      const resources = new SqliteConfigResourceRepo(db)
      const workflow = resources.getByName('WorkflowProfile', 'coding-guard')
      if (workflow == null) throw new Error('seeded Factory is missing WorkflowProfile coding-guard')
      resources.update(workflow.id, {
        spec: {
          ...(workflow.spec ?? {}),
          path: workflowProfilePath,
        },
      })
    }
    return seed
  } finally {
    db.close()
  }
}
