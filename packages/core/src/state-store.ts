import { initDb, readSchemaMigrationStatus, type SchemaMigrationStatus } from './db.js'
import type { SqliteDatabase } from './db-migrations.js'
import { SqliteAgentRepo } from './repos/agent.js'
import { SqliteAttemptLeaseRepo } from './repos/attempt-lease.js'
import { ConfigBackedFactoryCatalogRepo } from './repos/factory-catalog.js'
import { SqliteConfigResourceRepo } from './repos/config-resource.js'
import { SqliteComponentRepo, SqliteRepositoryRepo } from './repos/repository.js'
import { SqliteDecisionRepo } from './repos/decision.js'
import { SqliteEvidenceRepo, SqliteGateEvaluationRepo } from './repos/evidence.js'
import { SqliteFactoryRepo } from './repos/factory.js'
import { SqliteFactoryRuntimeSettingsRepo } from './repos/runtime-settings.js'
import { SqliteFactorySecretRepo } from './repos/secret.js'
import { SqliteFactoryViewStateRepo } from './repos/factory-view-state.js'
import { SqliteProjectAgentRepo, SqliteProjectRepo } from './repos/project.js'
import { SqliteRunActivityRepo } from './repos/run-activity.js'
import { SqliteRunCheckpointRepo } from './repos/run-checkpoint.js'
import { SqliteRunRepo, SqliteRunStageHistoryRepo } from './repos/run.js'
import { SqliteRunUpdateRepo } from './repos/run-update.js'
import { SqliteSessionRunMappingRepo } from './repos/session.js'
import { SqliteSpecDependencyRepo, SqliteSpecRepo } from './repos/spec.js'
import { SqliteTargetRepo } from './repos/target.js'
import { SqliteTaskDependencyRepo, SqliteTaskRepo } from './repos/task.js'

export interface StateStoreRepos {
  readonly factories: SqliteFactoryRepo
  readonly projects: SqliteProjectRepo
  readonly projectAgents: SqliteProjectAgentRepo
  readonly repositories: SqliteRepositoryRepo
  readonly components: SqliteComponentRepo
  readonly targets: SqliteTargetRepo
  readonly configResources: SqliteConfigResourceRepo
  readonly catalog: ConfigBackedFactoryCatalogRepo
  readonly runtimeSettings: SqliteFactoryRuntimeSettingsRepo
  readonly factoryViewState: SqliteFactoryViewStateRepo
  readonly secrets: SqliteFactorySecretRepo
  readonly agents: SqliteAgentRepo
  readonly specs: SqliteSpecRepo
  readonly specDependencies: SqliteSpecDependencyRepo
  readonly tasks: SqliteTaskRepo
  readonly taskDependencies: SqliteTaskDependencyRepo
  readonly decisions: SqliteDecisionRepo
  readonly attemptLeases: SqliteAttemptLeaseRepo
  readonly runs: SqliteRunRepo
  readonly runCheckpoints: SqliteRunCheckpointRepo
  readonly runHistory: SqliteRunStageHistoryRepo
  readonly runUpdates: SqliteRunUpdateRepo
  readonly runActivity: SqliteRunActivityRepo
  readonly evidence: SqliteEvidenceRepo
  readonly gateEvaluations: SqliteGateEvaluationRepo
  readonly sessionRunMappings: SqliteSessionRunMappingRepo
}

export interface StateStore {
  readonly kind: 'sqlite'
  readonly db: SqliteDatabase
  readonly repos: StateStoreRepos
  schemaStatus(): SchemaMigrationStatus
  close(): void
}

export class SqliteStateStore implements StateStore {
  readonly kind = 'sqlite' as const

  static open(dbPath: string): SqliteStateStore {
    return new SqliteStateStore(initDb(dbPath))
  }

  readonly repos: StateStoreRepos

  constructor(readonly db: SqliteDatabase) {
    this.repos = createSqliteStateStoreRepos(db)
  }

  schemaStatus(): SchemaMigrationStatus {
    return readSchemaMigrationStatus(this.db)
  }

  close(): void {
    this.db.close()
  }
}

export function createSqliteStateStoreRepos(db: SqliteDatabase): StateStoreRepos {
  const configResources = new SqliteConfigResourceRepo(db)
  const attemptLeases = new SqliteAttemptLeaseRepo(db)
  return {
    factories: new SqliteFactoryRepo(db),
    projects: new SqliteProjectRepo(db),
    projectAgents: new SqliteProjectAgentRepo(db),
    repositories: new SqliteRepositoryRepo(db),
    components: new SqliteComponentRepo(db),
    targets: new SqliteTargetRepo(db),
    configResources,
    catalog: new ConfigBackedFactoryCatalogRepo(configResources),
    runtimeSettings: new SqliteFactoryRuntimeSettingsRepo(db),
    factoryViewState: new SqliteFactoryViewStateRepo(db),
    secrets: new SqliteFactorySecretRepo(db),
    agents: new SqliteAgentRepo(db),
    specs: new SqliteSpecRepo(db),
    specDependencies: new SqliteSpecDependencyRepo(db),
    tasks: new SqliteTaskRepo(db),
    taskDependencies: new SqliteTaskDependencyRepo(db),
    decisions: new SqliteDecisionRepo(db),
    attemptLeases,
    runs: new SqliteRunRepo(db, attemptLeases),
    runCheckpoints: new SqliteRunCheckpointRepo(db, attemptLeases),
    runHistory: new SqliteRunStageHistoryRepo(db),
    runUpdates: new SqliteRunUpdateRepo(db),
    runActivity: new SqliteRunActivityRepo(db),
    evidence: new SqliteEvidenceRepo(db, attemptLeases),
    gateEvaluations: new SqliteGateEvaluationRepo(db),
    sessionRunMappings: new SqliteSessionRunMappingRepo(db),
  }
}
